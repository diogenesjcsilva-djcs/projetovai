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

  it('limits acceptance to rides in the authenticated driver city', async () => {
    const client = { query: jest.fn(), release: jest.fn() };
    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: driver.sub }] }) // eligible driver
      .mockResolvedValueOnce({ rows: [] }) // no ride in driver's city
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK
    const db = { connect: jest.fn().mockResolvedValue(client) } as unknown as Pool;
    const service = new RidesService(db);

    await expect(service.accept(driver, 'ride-id')).rejects.toBeInstanceOf(ConflictException);
    const acceptSql = client.query.mock.calls[2][0] as string;
    expect(acceptSql).toContain('ST_DWithin');
    expect(acceptSql).toContain('p.search_wave_timeout_seconds');
    expect(client.query.mock.calls.map(call => call[0])).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});