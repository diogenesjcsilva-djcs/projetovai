import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { createHash } from 'node:crypto';
import { AuthService } from './auth.service';
import { SmsGateway } from './sms.gateway';

const enabled = process.env.RUN_INTEGRATION_TESTS === '1';
const integrationDescribe = enabled ? describe : describe.skip;

integrationDescribe('AuthService PostgreSQL/Redis integration', () => {
  let postgres: Pool;
  let redis: Redis;
  let service: AuthService;
  let sentCode: string | undefined;
  let phone: string;
  const requestIp = '198.51.100.77';
  const otpSecret = 'integration-test-secret-at-least-32-characters';
  const jwtSecret = 'integration-test-jwt-secret-at-least-32-characters';
  const configValues: Record<string, string> = {
    AUTH_OTP_HMAC_SECRET: otpSecret,
    JWT_ACCESS_SECRET: jwtSecret,
    JWT_ISSUER: 'projetovai-integration',
    JWT_AUDIENCE: 'projetovai-integration-tests',
  };

  beforeAll(async () => {
    if (!process.env.DATABASE_URL || !process.env.REDIS_URL) {
      throw new Error('DATABASE_URL and REDIS_URL are required for auth integration tests');
    }
    postgres = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000 });
    redis = new Redis(process.env.REDIS_URL, { connectTimeout: 3000, maxRetriesPerRequest: 1 });
    await Promise.all([postgres.query('SELECT 1'), redis.ping()]);
  }, 15000);

  beforeEach(async () => {
    phone = `+5581${Date.now().toString().slice(-8)}`;
    sentCode = undefined;
    const config = {
      get: jest.fn((key: string) => configValues[key]),
    } as unknown as ConfigService;
    const sms = {
      sendOtp: jest.fn(async (_phone: string, code: string) => {
        sentCode = code;
      }),
    } as unknown as SmsGateway;
    service = new AuthService(postgres, redis, config, sms);
  });

  afterEach(async () => {
    if (!phone) return;
    const user = await postgres.query<{ id: string }>('SELECT id FROM users WHERE phone_e164 = $1', [phone]);
    if (user.rows[0]) {
      await postgres.query('DELETE FROM auth_sessions WHERE user_id = $1', [user.rows[0].id]);
      await postgres.query('DELETE FROM driver_profiles WHERE user_id = $1', [user.rows[0].id]);
      await postgres.query('DELETE FROM users WHERE id = $1', [user.rows[0].id]);
    }
    await postgres.query('DELETE FROM auth_otp_challenges WHERE phone_e164 = $1', [phone]);
    const digest = (value: string) => createHash('sha256').update(value).digest('hex');
    await redis.del(`otp:phone:${digest(phone)}`, `otp:ip:${digest(requestIp)}`);
  });

  afterAll(async () => {
    if (redis) await redis.quit().catch(() => undefined);
    if (postgres) await postgres.end().catch(() => undefined);
  });

  it('requests OTP, creates a passenger session, rotates refresh token, and logs out', async () => {
    await expect(service.requestOtp({ phone, role: 'passenger' }, requestIp))
      .resolves.toEqual({ message: 'Se o número puder receber mensagens, o código será enviado.' });
    expect(sentCode).toMatch(/^\d{6}$/);

    const firstSession = await service.verifyOtp({ phone, code: sentCode!, role: 'passenger' });
    expect(firstSession).toMatchObject({
      tokenType: 'Bearer',
      expiresIn: 900,
      user: { role: 'passenger' },
    });
    expect(typeof firstSession.accessToken).toBe('string');
    expect(typeof firstSession.refreshToken).toBe('string');

    const rotatedSession = await service.refresh(firstSession.refreshToken as string);
    expect(rotatedSession).toMatchObject({
      tokenType: 'Bearer',
      expiresIn: 900,
      user: { id: (firstSession.user as { id: string }).id, role: 'passenger' },
    });
    expect(rotatedSession.refreshToken).not.toBe(firstSession.refreshToken);
    await expect(service.refresh(firstSession.refreshToken as string)).rejects.toThrow();

    await expect(service.logout(rotatedSession.refreshToken as string)).resolves.toEqual({ success: true });
    await expect(service.refresh(rotatedSession.refreshToken as string)).rejects.toThrow();
  }, 15000);

  it('creates driver accounts pending manual review', async () => {
    await service.requestOtp({ phone, role: 'driver' }, requestIp);
    expect(sentCode).toMatch(/^\d{6}$/);
    const session = await service.verifyOtp({ phone, code: sentCode!, role: 'driver' });
    const result = await postgres.query<{ status: string }>(
      'SELECT status FROM driver_profiles WHERE user_id = $1',
      [(session.user as { id: string }).id],
    );
    expect(result.rows).toEqual([{ status: 'pending_review' }]);
  }, 15000);
});
