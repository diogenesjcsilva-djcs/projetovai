import { Pool } from 'pg';
import Redis from 'ioredis';

const enabled = process.env.RUN_INTEGRATION_TESTS === '1';
const integrationDescribe = enabled ? describe : describe.skip;

integrationDescribe('PostgreSQL/PostGIS and Redis integration', () => {
  let postgres: Pool;
  let redis: Redis;
  const redisKey = `projetovai:integration:${process.pid}:${Date.now()}`;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL || !process.env.REDIS_URL) {
      throw new Error('DATABASE_URL and REDIS_URL are required for integration tests');
    }
    postgres = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000 });
    redis = new Redis(process.env.REDIS_URL, {
      connectTimeout: 3000,
      maxRetriesPerRequest: 1,
    });
    await Promise.all([postgres.query('SELECT 1'), redis.ping()]);
  }, 15000);

  afterAll(async () => {
    if (redis) {
      await redis.del(redisKey).catch(() => undefined);
      await redis.quit().catch(() => undefined);
    }
    if (postgres) await postgres.end().catch(() => undefined);
  });

  it('applies the initial schema and seeds the Paulista pilot city', async () => {
    const result = await postgres.query<{
      city_name: string;
      city_slug: string;
      postgis_available: boolean;
      users_table_exists: boolean;
      otp_table_exists: boolean;
      sessions_table_exists: boolean;
    }>(`
      SELECT
        c.name AS city_name,
        c.slug AS city_slug,
        EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') AS postgis_available,
        to_regclass('public.users') IS NOT NULL AS users_table_exists,
        to_regclass('public.auth_otp_challenges') IS NOT NULL AS otp_table_exists,
        to_regclass('public.auth_sessions') IS NOT NULL AS sessions_table_exists
      FROM cities c
      WHERE c.slug = 'paulista-pe'
    `);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      city_name: 'Paulista',
      city_slug: 'paulista-pe',
      postgis_available: true,
      users_table_exists: true,
      otp_table_exists: true,
      sessions_table_exists: true,
    });
  }, 10000);

  it('enforces the E.164 phone format at the database boundary', async () => {
    await expect(
      postgres.query(
        "INSERT INTO users (phone_e164, role) VALUES ('not-a-phone', 'passenger')",
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('connects to Redis and supports increment plus expiry for rate limits', async () => {
    const count = await redis.incr(redisKey);
    const ttl = await redis.expire(redisKey, 30);
    const nextCount = await redis.incr(redisKey);

    expect(count).toBe(1);
    expect(ttl).toBe(1);
    expect(nextCount).toBe(2);
    expect(await redis.ttl(redisKey)).toBeGreaterThan(0);
  });
});
