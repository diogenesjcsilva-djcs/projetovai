import { ConflictException } from '@nestjs/common';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { RidesService } from './rides.service';

/**
 * Runs only against the disposable Postgres/PostGIS service in CI.
 * It exercises the real RidesService with two independent pool connections.
 */
const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === '1';

(integrationEnabled ? describe : describe.skip)('RidesService concurrent acceptance (PostgreSQL)', () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
  const service = new RidesService(pool);
  const driverA = randomUUID();
  const driverB = randomUUID();
  const passenger = randomUUID();
  const rideId = randomUUID();
  const phones = [
    `+5511${Date.now().toString().slice(-9)}`,
    `+5521${Date.now().toString().slice(-9)}`,
    `+5531${Date.now().toString().slice(-9)}`,
  ];

  beforeAll(async () => {
    const city = await pool.query<{ id: string }>(
      `SELECT id FROM cities WHERE slug = 'paulista-pe'`,
    );
    if (!city.rows[0]) throw new Error('Paulista pilot city seed is missing');
    const cityId = city.rows[0].id;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO users (id, phone_e164, role, status, city_id)
         VALUES ($1, $4, 'passenger', 'active', $5),
                ($2, $6, 'driver', 'active', $5),
                ($3, $7, 'driver', 'active', $5)`,
        [passenger, driverA, driverB, phones[0], cityId, phones[1], phones[2]],
      );
      await client.query(
        `INSERT INTO driver_profiles (user_id, city_id, status)
         VALUES ($1, $3, 'approved'), ($2, $3, 'approved')`,
        [driverA, driverB, cityId],
      );
      await client.query(
        `INSERT INTO city_pricing_policies (
           city_id, version, base_fare_cents, price_per_km_cents,
           price_per_minute_cents, minimum_fare_cents,
           initial_search_radius_meters, max_search_radius_meters,
           driver_location_max_age_seconds, search_wave_timeout_seconds, is_active
         )
         SELECT $1, COALESCE(MAX(version), 0) + 1, 500, 200, 30, 500,
           3000, 10000, 300, 15, true
         FROM city_pricing_policies WHERE city_id = $1`,
        [cityId],
      );
      await client.query(
        `INSERT INTO driver_locations (driver_user_id, location, is_available, updated_at)
         VALUES
           ($1, ST_SetSRID(ST_MakePoint(-34.9, -8.0), 4326)::geography, true, now()),
           ($2, ST_SetSRID(ST_MakePoint(-34.9, -8.0), 4326)::geography, true, now())`,
        [driverA, driverB],
      );
      await client.query(
        `INSERT INTO rides (
           id, city_id, passenger_user_id, status, pickup_location, pickup_address,
           destination_location, destination_address, idempotency_key
         )
         VALUES (
           $1, $2, $3, 'searching',
           ST_SetSRID(ST_MakePoint(-34.9, -8.0), 4326)::geography, 'Origem teste',
           ST_SetSRID(ST_MakePoint(-34.91, -8.01), 4326)::geography, 'Destino teste',
           $4
         )`,
        [rideId, cityId, passenger, `concurrent-${rideId}`],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  it('allows exactly one of two drivers to accept the same ride', async () => {
    const results = await Promise.allSettled([
      service.accept({ sub: driverA, role: 'driver', sid: 'integration-a' }, rideId),
      service.accept({ sub: driverB, role: 'driver', sid: 'integration-b' }, rideId),
    ]);

    const fulfilled = results.filter(result => result.status === 'fulfilled');
    const rejected = results.filter(result => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const rejection = rejected[0];
    expect(rejection).toBeDefined();
    if (rejection?.status === 'rejected') {
      expect(rejection.reason).toBeInstanceOf(ConflictException);
    }

    const storedRide = await pool.query(
      `SELECT driver_user_id, status FROM rides WHERE id = $1`,
      [rideId],
    );
    expect(storedRide.rows[0].status).toBe('accepted');
    expect([driverA, driverB]).toContain(storedRide.rows[0].driver_user_id);

    const acceptedDriverLocation = await pool.query(
      `SELECT is_available FROM driver_locations WHERE driver_user_id = $1`,
      [storedRide.rows[0].driver_user_id],
    );
    expect(acceptedDriverLocation.rows[0].is_available).toBe(false);

    const acceptedEvents = await pool.query(
      `SELECT count(*)::integer AS count FROM ride_events
       WHERE ride_id = $1 AND event_type = 'ride_accepted'`,
      [rideId],
    );
    expect(acceptedEvents.rows[0].count).toBe(1);

    const assignedDriver = storedRide.rows[0].driver_user_id;
    const driverUser = { sub: assignedDriver, role: 'driver' as const, sid: 'integration-completion' };
    await service.updateStatus(driverUser, rideId, { status: 'driver_arriving' });
    await service.updateStatus(driverUser, rideId, { status: 'in_progress' });
    await service.updateStatus(driverUser, rideId, { status: 'completed' });

    const completedDriverLocation = await pool.query(
      `SELECT is_available FROM driver_locations WHERE driver_user_id = $1`,
      [assignedDriver],
    );
    expect(completedDriverLocation.rows[0].is_available).toBe(true);
  });
});
