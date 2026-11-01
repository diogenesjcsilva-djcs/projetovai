import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import { AccessTokenGuard } from './access-token.guard';

describe('AccessTokenGuard', () => {
  const secret = 'test-secret-that-is-at-least-thirty-two-characters';
  const config = {
    get: jest.fn((key: string) => ({
      JWT_ACCESS_SECRET: secret,
      JWT_ISSUER: 'projetovai-api',
      JWT_AUDIENCE: 'projetovai-clients',
    } as Record<string, string>)[key]),
  } as unknown as ConfigService;
  const db = { query: jest.fn() } as unknown as Pool;
  const request: any = { headers: {} };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as ExecutionContext;
  let guard: AccessTokenGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    request.headers = {};
    delete request.user;
    guard = new AccessTokenGuard(config, db);
  });

  it('rejects requests without a bearer token', async () => {
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('rejects a validly signed token when its session was revoked or is absent', async () => {
    const token = jwt.sign({ role: 'passenger', sid: 'session-id' }, secret, {
      algorithm: 'HS256', subject: 'user-id', issuer: 'projetovai-api',
      audience: 'projetovai-clients', expiresIn: '5m',
    });
    request.headers.authorization = `Bearer ${token}`;
    (db.query as jest.Mock).mockResolvedValue({ rows: [] });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('revoked_at IS NULL'), [
      'session-id', 'user-id', 'passenger',
    ]);
  });

  it('accepts a valid token only when its active session and account match', async () => {
    const token = jwt.sign({ role: 'driver', sid: 'session-id' }, secret, {
      algorithm: 'HS256', subject: 'user-id', issuer: 'projetovai-api',
      audience: 'projetovai-clients', expiresIn: '5m',
    });
    request.headers.authorization = `Bearer ${token}`;
    (db.query as jest.Mock).mockResolvedValue({ rows: [{ id: 'session-id' }] });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({ sub: 'user-id', sid: 'session-id', role: 'driver' });
  });

  it('rejects a token signed with an unexpected algorithm or secret', async () => {
    const token = jwt.sign({ role: 'passenger', sid: 'session-id' }, 'another-secret-that-is-long-enough-32', {
      algorithm: 'HS256', subject: 'user-id', issuer: 'projetovai-api',
      audience: 'projetovai-clients', expiresIn: '5m',
    });
    request.headers.authorization = `Bearer ${token}`;
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(db.query).not.toHaveBeenCalled();
  });
});
