import { HealthService } from './health.service';

describe('HealthService', () => {
  it('returns a successful liveness response', () => {
    const service = new HealthService({} as never, {} as never);
    const result = service.liveness();

    expect(result.status).toBe('ok');
    expect(result.service).toBe('transporte-api');
    expect(Number.isNaN(Date.parse(result.timestamp))).toBe(false);
  });

  it('reports dependencies unavailable when readiness checks fail', async () => {
    const postgres = { query: jest.fn().mockRejectedValue(new Error('offline')) };
    const redis = {
      status: 'ready',
      ping: jest.fn().mockRejectedValue(new Error('offline')),
    };
    const service = new HealthService(postgres as never, redis as never);

    const result = await service.readiness();
    expect(result.status).toBe('degraded');
    expect(result.checks).toEqual({ postgres: 'error', redis: 'error' });
  });
});
