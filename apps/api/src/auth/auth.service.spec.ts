import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
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
    await expect(service.requestOtp({ phone: '+5511999999999', role: 'passenger' }, '127.0.0.1'))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(redis.incr).not.toHaveBeenCalled();
    expect(sms.sendOtp).not.toHaveBeenCalled();
  });

  it('does not verify OTP when the HMAC secret is not configured', async () => {
    const config = { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService;
    const service = new AuthService(postgres, redis, config, sms);
    await expect(service.verifyOtp({ phone: '+5511999999999', code: '123456', role: 'passenger' }))
      .rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('SmsGateway SMSGo integration', () => {
  let values: Record<string, string | undefined>;
  let gateway: SmsGateway;
  const originalFetch = global.fetch;

  beforeEach(() => {
    values = { SMS_PROVIDER: 'smsgo', SMSGO_API_KEY: 'unit-test-key' };
    const config = { get: jest.fn((key: string) => values[key]) } as unknown as ConfigService;
    gateway = new SmsGateway(config);
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('exchanges the API key for a token and sends an OTP request using the REST field name', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'test-bearer-token' }) })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    await expect(gateway.sendOtp('+5581999999999', '123456')).resolves.toBeUndefined();

    expect(global.fetch).toHaveBeenCalledTimes(2);
    const [tokenUrl, tokenOptions] = (global.fetch as jest.Mock).mock.calls[0];
    expect(tokenUrl).toBe('https://api.smsgo.com.br/v1/auth/token');
    expect(tokenOptions.headers['SMSGo-key']).toBe('unit-test-key');
    const [sendUrl, sendOptions] = (global.fetch as jest.Mock).mock.calls[1];
    expect(sendUrl).toBe('https://api.smsgo.com.br/v1/sms/send/single');
    expect(sendOptions.headers.authorization).toBe('Bearer test-bearer-token');
    expect(JSON.parse(sendOptions.body)).toEqual({
      phone: '+5581999999999',
      message: expect.stringContaining('123456'),
      sms_type_id: 2,
    });
  });

  it('reuses the cached token for subsequent OTP messages', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'test-bearer-token' }) })
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    await gateway.sendOtp('+5581999999999', '123456');
    await gateway.sendOtp('+5581888888888', '654321');
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it('refreshes the token and retries once after HTTP 401', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'expired-token' }) })
      .mockResolvedValueOnce({ ok: false, status: 401 })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'new-token' }) })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    await expect(gateway.sendOtp('+5581999999999', '123456')).resolves.toBeUndefined();
    expect(global.fetch).toHaveBeenCalledTimes(4);
    expect((global.fetch as jest.Mock).mock.calls[3][1].headers.authorization).toBe('Bearer new-token');
  });

  it('fails closed for an unsupported provider', async () => {
    values.SMS_PROVIDER = 'generic';
    await expect(gateway.sendOtp('+5581999999999', '123456'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('fails closed if credentials are missing', async () => {
    values.SMSGO_API_KEY = '';
    await expect(gateway.sendOtp('+5581999999999', '123456'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('does not expose provider errors to the client', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 401 });
    await expect(gateway.sendOtp('+5581999999999', '123456'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('logs provider HTTP status without exposing credentials, phone, or OTP', async () => {
    const warn = jest.spyOn(require('@nestjs/common').Logger.prototype, 'warn').mockImplementation(() => undefined);
    const error = jest.spyOn(require('@nestjs/common').Logger.prototype, 'error').mockImplementation();
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'secret-bearer-token' }) })
      .mockResolvedValueOnce({ ok: false, status: 402 });

    await expect(gateway.sendOtp('+5581999999999', '123456'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);

    const logged = [...warn.mock.calls, ...error.mock.calls].flat().join(' ');
    expect(logged).toContain('status=402');
    expect(logged).not.toContain('secret-bearer-token');
    expect(logged).not.toContain('unit-test-key');
    expect(logged).not.toContain('+5581999999999');
    expect(logged).not.toContain('123456');
  });

  it('handles network failures with a generic response', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('provider internal error'));
    await expect(gateway.sendOtp('+5581999999999', '123456'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
