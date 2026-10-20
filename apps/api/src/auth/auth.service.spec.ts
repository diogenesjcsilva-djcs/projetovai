import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { AuthService } from './auth.service';
import { SmsGateway } from './sms.gateway';

describe('AuthService security defaults', () => {
  const postgres = {} as Pool;
  const redis = { incr: jest.fn(), expire: jest.fn() } as unknown as Redis;
  const sms = { sendOtp: jest.fn() } as unknown as SmsGateway;

  it('does not issue an OTP when the HMAC secret is not configured', async () => {
    const config = { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService;
    const service = new AuthService(postgres, redis, config, sms);

    await expect(
      service.requestOtp({ phone: '+5511999999999', role: 'passenger' }, '127.0.0.1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(redis.incr).not.toHaveBeenCalled();
    expect(sms.sendOtp).not.toHaveBeenCalled();
  });

  it('does not verify OTP when the HMAC secret is not configured', async () => {
    const config = { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService;
    const service = new AuthService(postgres, redis, config, sms);

    await expect(
      service.verifyOtp({ phone: '+5511999999999', code: '123456', role: 'passenger' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
