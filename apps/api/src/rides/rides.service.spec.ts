import { ConflictException } from '@nestjs/common';
import { Pool } from 'pg';
import { RidesService } from './rides.service';

describe('RidesService ride lifecycle safeguards', () => {
  const passenger = { sub: 'passenger-id', role: 'passenger' as const, sid: 'session-id' };
  const driver = { sub: 'driver-id', role: 'driver' as const, sid: 'session-id' };
  const ride = {
    id: 'ride-id', city_id: 'city-id', passenger_user_id: 'passenger-id',
    driver_user_id: null, status: 'searching', pickup_address: 'Origem',
    destination_address: 'Destino', estimated_distance_meters: null,
    estimated_duration_seconds: null, estimated_fare_cents: null, final_fare_cents: null,
  };

  it('calculates straight-line distance on the server and does not invent a fare', async () => {
    const db = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ id: passenger.sub, role: 'passenger', city_id: 'city-id' }] })
        .mockResolvedValueOnce({ rows: [{
          id: 'policy-id', version: 1, base_fare_cents: 500,
          price_per_km_cents: 200, price_per_minute_cents: 30,
          minimum_fare_cents: 700, currency: 'BRL',
        }] }),
    } as unknown as Pool;
    const service = new RidesService(db);

    const estimate = await service.estimate(passenger, {
      pickup: { latitude: -8.0, longitude: -34.9 },
      destination: { latitude: -8.1, longitude: -34.8 },
    });

    expect(estimate.distance.method).toBe('haversine_straight_line');
    expect(estimate.distance.meters).toBeGreaterThan(0);
    expect(estimate.durationSeconds).toBeNull();
    expect(estimate.fare).toBeNull();
    expect(estimate.fareAvailable).toBe(false);
    expect(estimate.reason).toBe('ROUTE_DURATION_UNAVAILABLE');
  });

  it('commits ride creation and its audit event in one transaction', async () => {
    const client = { query: jest.fn(), release: jest.fn() };
    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'policy-id', version: 1 }] }) // active dispatch policy
      .mockResolvedValueOnce({ rows: [ride] }) // INSERT ride
      .mockResolvedValueOnce({ rows: [] }) // requested event
      .mockResolvedValueOnce({ rows: [] }) // search started event
      .mockResolvedValueOnce({ rows: [] }); // COMMIT
    const db = {
      query: jest.fn().mockResolvedValue({ rows: [{
        id: passenger.sub, role: 'passenger', city_id: 'city-id',
      }] }),
      connect: jest.fn().mockResolvedValue(client),
    } as unknown as Pool;
    const service = new RidesService(db);

    await expect(service.create(passenger, {
      pickup: { latitude: -8.0, longitude: -34.9 },
      destination: { latitude: -8.1, longitude: -34.8 },
      pickupAddress: 'Origem válida',
      destinationAddress: 'Destino válido',
    }, 'idem-123')).resolves.toEqual(ride);

    expect(client.query.mock.calls.map(call => call[0])).toEqual([
      'BEGIN', expect.stringContaining('city_pricing_policies'),
      expect.stringContaining('INSERT INTO rides'),
      expect.stringContaining('INSERT INTO ride_events'),
      expect.stringContaining('INSERT INTO ride_events'), 'COMMIT',
    ]);
    expect(client.query.mock.calls[2][0]).toContain("'searching'");
    expect(client.query.mock.calls[4][0]).toContain("'ride_search_started'");
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('rolls back ride creation if the audit event cannot be written', async () => {
    const client = { query: jest.fn(), release: jest.fn() };
    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'policy-id', version: 1 }] })
      .mockResolvedValueOnce({ rows: [ride] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error('audit insert failed'))
      .mockResolvedValueOnce({ rows: [] });
    const db = {
      query: jest.fn().mockResolvedValue({ rows: [{
        id: passenger.sub, role: 'passenger', city_id: 'city-id',
      }] }),
      connect: jest.fn().mockResolvedValue(client),
    } as unknown as Pool;
    const service = new RidesService(db);

    await expect(service.create(passenger, {
      pickup: { latitude: -8.0, longitude: -34.9 },
      destination: { latitude: -8.1, longitude: -34.8 },
      pickupAddress: 'Origem válida',
      destinationAddress: 'Destino válido',
    }, 'idem-123')).rejects.toThrow('audit insert failed');

    expect(client.query.mock.calls.map(call => call[0])).toContain('ROLLBACK');
    expect(client.query.mock.calls.map(call => call[0])).not.toContain('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });


  it('returns a conflict when a passenger requests a second active ride with a new idempotency key', async () => {
    const client = { query: jest.fn(), release: jest.fn() };
    const uniqueViolation = Object.assign(new Error('unique active ride'), { code: '23505' });
    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'policy-id', version: 1 }] })
      .mockRejectedValueOnce(uniqueViolation) // active passenger ride unique index
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK
    const db = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ id: passenger.sub, role: 'passenger', city_id: 'city-id' }] })
        .mockResolvedValueOnce({ rows: [] }), // no ride with this idempotency key
      connect: jest.fn().mockResolvedValue(client),
    } as unknown as Pool;
    const service = new RidesService(db);

    await expect(service.create(passenger, {
      pickup: { latitude: -8.0, longitude: -34.9 },
      destination: { latitude: -8.1, longitude: -34.8 },
      pickupAddress: 'Origem válida',
      destinationAddress: 'Destino válido',
    }, 'new-idempotency-key')).rejects.toBeInstanceOf(ConflictException);
    expect(client.query.mock.calls.map(call => call[0])).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('does not create a ride when the city has no active dispatch policy', async () => {
    const client = { query: jest.fn(), release: jest.fn() };
    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // no active policy
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK
    const db = {
      query: jest.fn().mockResolvedValue({ rows: [{
        id: passenger.sub, role: 'passenger', city_id: 'city-id',
      }] }),
      connect: jest.fn().mockResolvedValue(client),
    } as unknown as Pool;
    const service = new RidesService(db);

    await expect(service.create(passenger, {
      pickup: { latitude: -8.0, longitude: -34.9 },
      destination: { latitude: -8.1, longitude: -34.8 },
      pickupAddress: 'Origem válida',
      destinationAddress: 'Destino válido',
    }, 'idem-no-policy')).rejects.toThrow('Política de despacho indisponível');

    expect(client.query.mock.calls.map(call => call[0])).toContain('ROLLBACK');
    expect(client.query.mock.calls.some(call => String(call[0]).includes('INSERT INTO rides'))).toBe(false);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('returns only nearby searching rides and orders candidates by PostGIS distance', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ city_id: 'city-id' }] })
      .mockResolvedValueOnce({ rows: [{
        id: 'ride-near', pickup_distance_meters: 650,
        requested_at: new Date(), current_search_radius_meters: 3000,
      }] });
    const db = { query } as unknown as Pool;
    const service = new RidesService(db);

    const result = await service.availableRides(driver);
    expect(result.rides).toHaveLength(1);
    expect(result.rides[0].id).toBe('ride-near');
    expect(result.rides[0]).not.toHaveProperty('pickup_location');
    expect(result.rides[0]).not.toHaveProperty('driver_location');
    expect(query.mock.calls[1][0]).toContain('ST_DWithin');
    expect(query.mock.calls[1][0]).toContain('ST_Distance');
    expect(query.mock.calls[1][0]).toContain("r.status = 'searching'");
    expect(query.mock.calls[1][0]).toContain('search_wave_timeout_seconds');
  });


  it('rejects acceptance when the driver already has an active ride', async () => {
    const client = { query: jest.fn(), release: jest.fn() };
    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: driver.sub }] }) // lock driver row
      .mockResolvedValueOnce({ rows: [{ id: 'another-active-ride' }] }) // active ride found
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK
    const db = { connect: jest.fn().mockResolvedValue(client) } as unknown as Pool;
    const service = new RidesService(db);

    await expect(service.accept(driver, 'ride-id')).rejects.toBeInstanceOf(ConflictException);
    expect(client.query.mock.calls[1][0]).toContain('FOR UPDATE');
    expect(client.query.mock.calls[2][0]).toContain('driver_user_id');
    expect(client.query.mock.calls.some(call => String(call[0]).includes('UPDATE rides'))).toBe(false);
    expect(client.query.mock.calls.map(call => call[0])).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('limits acceptance to rides in the authenticated driver city', async () => {
    const client = { query: jest.fn(), release: jest.fn() };
    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: driver.sub }] }) // lock driver row
      .mockResolvedValueOnce({ rows: [] }) // no active ride assigned to driver
      .mockResolvedValueOnce({ rows: [{ id: driver.sub }] }) // eligible driver
      .mockResolvedValueOnce({ rows: [] }) // no ride in driver's city/radius
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK
    const db = { connect: jest.fn().mockResolvedValue(client) } as unknown as Pool;
    const service = new RidesService(db);

    await expect(service.accept(driver, 'ride-id')).rejects.toBeInstanceOf(ConflictException);
    const acceptSql = client.query.mock.calls[4][0] as string;
    expect(acceptSql).toContain('ST_DWithin');
    expect(acceptSql).toContain('p.search_wave_timeout_seconds');
    expect(client.query.mock.calls[1][0]).toContain('FOR UPDATE');
    expect(client.query.mock.calls[2][0]).toContain("status IN ('accepted', 'driver_arriving', 'in_progress')");
    expect(client.query.mock.calls.map(call => call[0])).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('restores driver availability when an assigned ride is completed', async () => {
    const client = { query: jest.fn(), release: jest.fn() };
    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: driver.sub, role: 'driver', city_id: 'city-id' }] })
      .mockResolvedValueOnce({ rows: [{ ...ride, driver_user_id: driver.sub, status: 'in_progress' }] })
      .mockResolvedValueOnce({ rows: [{ ...ride, driver_user_id: driver.sub, status: 'completed' }] })
      .mockResolvedValueOnce({ rows: [] }) // audit event
      .mockResolvedValueOnce({ rows: [] }) // restore driver availability
      .mockResolvedValueOnce({ rows: [] }); // COMMIT
    const db = { connect: jest.fn().mockResolvedValue(client) } as unknown as Pool;
    const service = new RidesService(db);

    await service.updateStatus(driver, 'ride-id', { status: 'completed' });

    const availabilityUpdate = client.query.mock.calls.find(call =>
      String(call[0]).includes('UPDATE driver_locations'),
    );
    expect(availabilityUpdate).toBeDefined();
    expect(availabilityUpdate?.[0]).toContain('is_available = true');
    expect(availabilityUpdate?.[1]).toEqual([driver.sub]);
    expect(client.query.mock.calls.map(call => call[0])).toContain('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('restores driver availability when a passenger cancels an assigned ride', async () => {
    const client = { query: jest.fn(), release: jest.fn() };
    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: passenger.sub, role: 'passenger', city_id: 'city-id' }] })
      .mockResolvedValueOnce({ rows: [{ ...ride, driver_user_id: driver.sub, status: 'accepted' }] })
      .mockResolvedValueOnce({ rows: [{ ...ride, driver_user_id: driver.sub, status: 'cancelled' }] })
      .mockResolvedValueOnce({ rows: [] }) // audit event
      .mockResolvedValueOnce({ rows: [] }) // restore driver availability
      .mockResolvedValueOnce({ rows: [] }); // COMMIT
    const db = { connect: jest.fn().mockResolvedValue(client) } as unknown as Pool;
    const service = new RidesService(db);

    await service.updateStatus(passenger, 'ride-id', { status: 'cancelled' });

    const availabilityUpdate = client.query.mock.calls.find(call =>
      String(call[0]).includes('UPDATE driver_locations'),
    );
    expect(availabilityUpdate).toBeDefined();
    expect(availabilityUpdate?.[1]).toEqual([driver.sub]);
    expect(client.query.mock.calls.map(call => call[0])).toContain('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });
  it('returns ride events only to an authorized participant and supports a stable cursor', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: passenger.sub, role: 'passenger', city_id: 'city-id' }] })
      .mockResolvedValueOnce({ rows: [{ passenger_user_id: passenger.sub, driver_user_id: null }] })
      .mockResolvedValueOnce({ rows: [{
        id: '11111111-1111-4111-8111-111111111111',
        previous_status: 'requested', new_status: 'searching',
        event_type: 'ride_search_started', metadata: {}, created_at: new Date(),
      }] });
    const service = new RidesService({ query } as unknown as Pool);

    const result = await service.events(passenger, 'ride-id');
    expect(result.events).toHaveLength(1);
    expect(result.nextCursor).toBe('11111111-1111-4111-8111-111111111111');
    expect(result.hasMore).toBe(false);
    expect(query.mock.calls[2][0]).toContain('ORDER BY created_at ASC, id ASC');
    expect(query.mock.calls[2][0]).toContain('LIMIT 100');
  });

  it('rejects an event cursor that does not belong to the requested ride', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: passenger.sub, role: 'passenger', city_id: 'city-id' }] })
      .mockResolvedValueOnce({ rows: [{ passenger_user_id: passenger.sub, driver_user_id: null }] })
      .mockResolvedValueOnce({ rows: [] });
    const service = new RidesService({ query } as unknown as Pool);

    await expect(service.events(
      passenger, 'ride-id', '11111111-1111-4111-8111-111111111111',
    )).rejects.toThrow('Cursor não pertence a esta corrida');
    expect(query).toHaveBeenCalledTimes(3);
  });

});