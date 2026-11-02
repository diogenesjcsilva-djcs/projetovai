import { ForbiddenException } from '@nestjs/common';
import { Pool } from 'pg';
import { PricingPoliciesService } from './pricing-policies.service';

describe('PricingPoliciesService administrative lifecycle', () => {
  const admin = { sub: 'admin-id', role: 'admin' as const, sid: 'session-id' };
  const passenger = { sub: 'passenger-id', role: 'passenger' as const, sid: 'session-id' };
  const dto = {
    baseFareCents: 500,
    pricePerKmCents: 200,
    pricePerMinuteCents: 30,
    minimumFareCents: 700,
  };

  it('rejects non-admin users before opening a database transaction', async () => {
    const db = { query: jest.fn(), connect: jest.fn() } as unknown as Pool;
    const service = new PricingPoliciesService(db);

    await expect(service.createVersion(passenger, 'city-id', dto))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(db.query).not.toHaveBeenCalled();
    expect(db.connect).not.toHaveBeenCalled();
  });

  it('creates an inactive next version and records the actor in the same transaction', async () => {
    const client = { query: jest.fn(), release: jest.fn() };
    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'city-id' }] }) // lock city
      .mockResolvedValueOnce({ rows: [{ next_version: 2 }] }) // next version
      .mockResolvedValueOnce({ rows: [{ id: 'policy-id', version: 2, is_active: false }] })
      .mockResolvedValueOnce({ rows: [] }) // audit event
      .mockResolvedValueOnce({ rows: [] }); // COMMIT
    const db = {
      query: jest.fn().mockResolvedValue({ rows: [{ id: admin.sub, role: 'admin' }] }),
      connect: jest.fn().mockResolvedValue(client),
    } as unknown as Pool;
    const service = new PricingPoliciesService(db);

    await expect(service.createVersion(admin, 'city-id', dto))
      .resolves.toEqual({ id: 'policy-id', version: 2, is_active: false });

    const insertSql = client.query.mock.calls[3][0] as string;
    expect(insertSql).toContain('is_active');
    expect(insertSql).toContain('false');
    expect(client.query.mock.calls[4][0]).toContain('city_pricing_policy_events');
    expect(client.query.mock.calls.map(call => call[0])).toContain('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('rolls back when the policy audit event fails', async () => {
    const client = { query: jest.fn(), release: jest.fn() };
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'city-id' }] })
      .mockResolvedValueOnce({ rows: [{ next_version: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'policy-id', version: 1 }] })
      .mockRejectedValueOnce(new Error('audit unavailable'))
      .mockResolvedValueOnce({ rows: [] });
    const db = {
      query: jest.fn().mockResolvedValue({ rows: [{ id: admin.sub, role: 'admin' }] }),
      connect: jest.fn().mockResolvedValue(client),
    } as unknown as Pool;
    const service = new PricingPoliciesService(db);

    await expect(service.createVersion(admin, 'city-id', dto)).rejects.toThrow('audit unavailable');
    expect(client.query.mock.calls.map(call => call[0])).toContain('ROLLBACK');
    expect(client.query.mock.calls.map(call => call[0])).not.toContain('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('switches the active version and audits both sides atomically', async () => {
    const client = { query: jest.fn(), release: jest.fn() };
    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'city-id' }] }) // lock city
      .mockResolvedValueOnce({ rows: [{
        id: 'new-policy', city_id: 'city-id', version: 2, is_active: false,
        effective_from: new Date(Date.now() - 60_000), effective_until: null,
      }] })
      .mockResolvedValueOnce({ rows: [{ id: 'old-policy', version: 1 }] })
      .mockResolvedValueOnce({ rows: [] }) // deactivate old
      .mockResolvedValueOnce({ rows: [] }) // audit old
      .mockResolvedValueOnce({ rows: [{ id: 'new-policy', version: 2, is_active: true }] })
      .mockResolvedValueOnce({ rows: [] }) // audit new
      .mockResolvedValueOnce({ rows: [] }); // COMMIT
    const db = {
      query: jest.fn().mockResolvedValue({ rows: [{ id: admin.sub, role: 'admin' }] }),
      connect: jest.fn().mockResolvedValue(client),
    } as unknown as Pool;
    const service = new PricingPoliciesService(db);

    await expect(service.activateVersion(admin, 'city-id', 'new-policy'))
      .resolves.toEqual({ id: 'new-policy', version: 2, is_active: true });

    expect(client.query.mock.calls[4][0]).toContain('is_active = false');
    expect(client.query.mock.calls[5][0]).toContain('city_pricing_policy_events');
    expect(client.query.mock.calls[6][0]).toContain('is_active = true');
    expect(client.query.mock.calls[7][0]).toContain('city_pricing_policy_events');
    expect(client.query.mock.calls.map(call => call[0])).toContain('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
