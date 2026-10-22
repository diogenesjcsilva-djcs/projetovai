import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Inject } from '@nestjs/common';
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { Pool } from 'pg';
import Redis from 'ioredis';
import jwt from 'jsonwebtoken';
import { POSTGRES, REDIS } from '../infrastructure/infrastructure.module';
import { RequestOtpDto, VerifyOtpDto } from './auth.dto';
import { SmsGateway } from './sms.gateway';

type Role = 'passenger' | 'driver';
type UserRow = { id: string; role: Role; status: string; display_name: string | null };

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(POSTGRES) private readonly postgres: Pool,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly config: ConfigService,
    private readonly sms: SmsGateway,
  ) {}

  async requestOtp(dto: RequestOtpDto, requestIp: string): Promise<{ message: string }> {
    const otpSecret = this.config.get<string>('AUTH_OTP_HMAC_SECRET');
    if (!otpSecret || otpSecret.length < 32) {
      throw new ForbiddenException('Autenticação ainda não configurada');
    }

    await this.applyRateLimit(`otp:phone:${this.digest(dto.phone)}`, 3, 15 * 60);
    await this.applyRateLimit(`otp:ip:${this.digest(requestIp)}`, 10, 15 * 60);

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const codeHash = this.otpHash(dto.phone, code, otpSecret);
    const client = await this.postgres.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'UPDATE auth_otp_challenges SET consumed_at = now() WHERE phone_e164 = $1 AND consumed_at IS NULL',
        [dto.phone],
      );
      await client.query(
        `INSERT INTO auth_otp_challenges
          (phone_e164, code_hash, purpose, expires_at, request_ip_hash)
         VALUES ($1, $2, 'login', now() + interval '5 minutes', $3)`,
        [dto.phone, codeHash, this.digest(requestIp)],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      this.logger.error('Failed to persist OTP challenge');
      throw error;
    } finally {
      client.release();
    }

    await this.sms.sendOtp(dto.phone, code);
    return { message: 'Se o número puder receber mensagens, o código será enviado.' };
  }

  async verifyOtp(dto: VerifyOtpDto): Promise<Record<string, unknown>> {
    const otpSecret = this.config.get<string>('AUTH_OTP_HMAC_SECRET');
    if (!otpSecret || otpSecret.length < 32) {
      throw new ForbiddenException('Autenticação ainda não configurada');
    }

    const client = await this.postgres.connect();
    let user: UserRow;
    try {
      await client.query('BEGIN');
      const challenge = await client.query<{ id: string; code_hash: string; attempts: number }>(
        `SELECT id, code_hash, attempts FROM auth_otp_challenges
         WHERE phone_e164 = $1 AND consumed_at IS NULL AND expires_at > now()
         ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [dto.phone],
      );
      const row = challenge.rows[0];
      if (!row || row.attempts >= 5) {
        await client.query('ROLLBACK');
        throw new UnauthorizedException('Código inválido ou expirado');
      }

      const expected = Buffer.from(row.code_hash, 'hex');
      const actual = Buffer.from(this.otpHash(dto.phone, dto.code, otpSecret), 'hex');
      const valid = expected.length === actual.length && timingSafeEqual(expected, actual);
      if (!valid) {
        await client.query(
          'UPDATE auth_otp_challenges SET attempts = attempts + 1 WHERE id = $1',
          [row.id],
        );
        await client.query('COMMIT');
        throw new UnauthorizedException('Código inválido ou expirado');
      }

      await client.query(
        'UPDATE auth_otp_challenges SET consumed_at = now() WHERE id = $1',
        [row.id],
      );
      const found = await client.query<UserRow>(
        'SELECT id, role, status, display_name FROM users WHERE phone_e164 = $1 FOR UPDATE',
        [dto.phone],
      );
      if (found.rows[0]) {
        user = found.rows[0];
        if (user.role !== dto.role) {
          await client.query('ROLLBACK');
          throw new UnauthorizedException('Tipo de conta não corresponde');
        }
        if (user.status === 'suspended' || user.status === 'deleted') {
          await client.query('ROLLBACK');
          throw new ForbiddenException('Conta indisponível');
        }
        await client.query(
          'UPDATE users SET status = $2, phone_verified_at = COALESCE(phone_verified_at, now()), updated_at = now() WHERE id = $1',
          [user.id, 'active'],
        );
      } else {
        const city = await client.query<{ id: string }>(
          "SELECT id FROM cities WHERE slug = 'paulista-pe' AND is_active = true LIMIT 1",
        );
        const cityId = city.rows[0]?.id;
        const inserted = await client.query<UserRow>(
          `INSERT INTO users (phone_e164, role, status, phone_verified_at, city_id)
           VALUES ($1, $2, 'active', now(), $3)
           RETURNING id, role, status, display_name`,
          [dto.phone, dto.role, cityId ?? null],
        );
        user = inserted.rows[0]!;
        if (dto.role === 'driver') {
          if (!cityId) {
            await client.query('ROLLBACK');
            throw new ForbiddenException('Cidade piloto não configurada');
          }
          await client.query(
            "INSERT INTO driver_profiles (user_id, city_id, status) VALUES ($1, $2, 'pending_review')",
            [user.id, cityId],
          );
        }
      }

      const session = await this.createSession(client, user);
      await client.query('COMMIT');
      return session;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Transaction may already have been rolled back or committed.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async refresh(refreshToken: string): Promise<Record<string, unknown>> {
    if (refreshToken.length < 40 || refreshToken.length > 200) {
      throw new UnauthorizedException('Sessão inválida');
    }
    const tokenHash = this.digest(refreshToken);
    const client = await this.postgres.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<UserRow & { session_id: string }>(
        `SELECT u.id, u.role, u.status, u.display_name, s.id AS session_id
         FROM auth_sessions s JOIN users u ON u.id = s.user_id
         WHERE s.refresh_token_hash = $1 AND s.revoked_at IS NULL
           AND s.expires_at > now() AND u.status = 'active'
         FOR UPDATE OF s, u`,
        [tokenHash],
      );
      const user = result.rows[0];
      if (!user) {
        await client.query('ROLLBACK');
        throw new UnauthorizedException('Sessão inválida');
      }
      await client.query('UPDATE auth_sessions SET revoked_at = now() WHERE id = $1', [user.session_id]);
      const session = await this.createSession(client, user);
      await client.query('COMMIT');
      return session;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* transaction closed */ }
      throw error;
    } finally {
      client.release();
    }
  }

  async logout(refreshToken: string): Promise<{ success: true }> {
    if (refreshToken.length < 40 || refreshToken.length > 200) {
      throw new UnauthorizedException('Sessão inválida');
    }
    await this.postgres.query(
      'UPDATE auth_sessions SET revoked_at = now() WHERE refresh_token_hash = $1 AND revoked_at IS NULL',
      [this.digest(refreshToken)],
    );
    return { success: true };
  }

  private async createSession(
    client: import('pg').PoolClient,
    user: UserRow,
  ): Promise<Record<string, unknown>> {
    const jwtSecret = this.config.get<string>('JWT_ACCESS_SECRET');
    const issuer = this.config.get<string>('JWT_ISSUER');
    const audience = this.config.get<string>('JWT_AUDIENCE');
    if (!jwtSecret || jwtSecret.length < 32 || !issuer || !audience) {
      throw new ForbiddenException('Tokens de sessão ainda não configurados');
    }
    const refreshToken = randomBytes(48).toString('base64url');
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO auth_sessions (user_id, refresh_token_hash, expires_at)
       VALUES ($1, $2, now() + interval '30 days') RETURNING id`,
      [user.id, this.digest(refreshToken)],
    );
    const sessionId = inserted.rows[0]!.id;
    const accessToken = jwt.sign(
      { role: user.role, sid: sessionId },
      jwtSecret,
      { algorithm: 'HS256', subject: user.id, issuer, audience, expiresIn: '15m' },
    );
    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: 900,
      refreshToken,
      user: { id: user.id, role: user.role, displayName: user.display_name },
    };
  }

  private async applyRateLimit(key: string, limit: number, ttlSeconds: number): Promise<void> {
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, ttlSeconds);
    if (count > limit) {
      throw new HttpException('Tente novamente mais tarde', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private digest(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private otpHash(phone: string, code: string, secret: string): string {
    return createHmac('sha256', secret).update(`${phone}:${code}`).digest('hex');
  }
}
