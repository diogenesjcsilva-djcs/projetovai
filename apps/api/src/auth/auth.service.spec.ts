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

describe('SmsGateway Zenvia integration', () => {
  let values: Record<string, string | undefined>;
  let gateway: SmsGateway;
  const originalFetch = global.fetch;

  beforeEach(() => {
    values = { SMS_PROVIDER: 'zenvia', SMS_API_KEY: 'unit-test-token', SMS_SENDER_ID: 'ProjetoVai' };
    const config = { get: jest.fn((key: string) => values[key]) } as unknown as ConfigService;
    gateway = new SmsGateway(config);
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('sends the expected Zenvia REST request', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, status: 200 });
    await expect(gateway.sendOtp('+5581999999999', '123456')).resolves.toBeUndefined();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://api.zenvia.com/v1/channels/sms/messages');
    expect(options.headers['X-API-TOKEN']).toBe('unit-test-token');
    expect(JSON.parse(options.body)).toEqual({
      from: 'ProjetoVai',
      to: '+5581999999999',
      contents: [{ type: 'text', text: expect.stringContaining('123456') }],
    });
  });

  it('fails closed for an unsupported provider', async () => {
    values.SMS_PROVIDER = 'generic';
    await expect(gateway.sendOtp('+5581999999999', '123456'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('fails closed if credentials are missing', async () => {
    values.SMS_API_KEY = '';
    await expect(gateway.sendOtp('+5581999999999', '123456'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('does not expose provider errors to the client', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 401 });
    await expect(gateway.sendOtp('+5581999999999', '123456'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('handles network failures with a generic response', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('provider internal error'));
    await expect(gateway.sendOtp('+5581999999999', '123456'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
