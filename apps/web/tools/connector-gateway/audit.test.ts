import { describe, expect, it } from 'vitest';
import { toAuditEntry } from './audit';

const GRANT_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';

describe('toAuditEntry', () => {
  it('keeps exactly grant id, route, status, and latency', () => {
    expect(
      toAuditEntry({
        grantId: GRANT_ID,
        route: '/v0/tools/orders.list',
        status: 200,
        latencyMs: 12,
      })
    ).toEqual({
      grantId: GRANT_ID,
      route: '/v0/tools/orders.list',
      status: 200,
      latencyMs: 12,
    });
  });

  it('drops credentials, tokens, and payloads even when passed in', () => {
    expect(
      toAuditEntry({
        grantId: null,
        route: '/v0/tools/orders.list',
        status: 401,
        latencyMs: 3,
        token: 'mcn_secret',
        refresh_token: 'mcn_refresh_secret',
        authorization: 'Bearer mcn_secret',
        body: { merchant_id: 'x' },
        orders: [{ id: 'y' }],
      })
    ).toEqual({
      grantId: null,
      route: '/v0/tools/orders.list',
      status: 401,
      latencyMs: 3,
    });
  });

  it('rejects malformed entries', () => {
    const valid = {
      grantId: GRANT_ID,
      route: '/v0/tools/orders.list',
      status: 200,
      latencyMs: 1,
    };
    for (const bad of [
      null,
      'nope',
      { ...valid, grantId: 'not-a-uuid' },
      { ...valid, route: '' },
      { ...valid, route: 'x'.repeat(201) },
      { ...valid, status: 99 },
      { ...valid, status: 600 },
      { ...valid, latencyMs: -1 },
      { ...valid, latencyMs: 1.5 },
    ]) {
      expect(() => toAuditEntry(bad)).toThrow('invalid_gateway_audit_entry');
    }
  });
});
