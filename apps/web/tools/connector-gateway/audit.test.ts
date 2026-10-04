import type postgres from 'postgres';
import { describe, expect, it, vi } from 'vitest';
import { createGatewayAudit, recordGatewayAudit, toAuditEntry } from './audit';

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

it('sets transaction-local timeouts before the audit insert', async () => {
  const statements: string[] = [];
  const transaction = async (parts: TemplateStringsArray) => {
    statements.push(parts.join('?'));
  };
  const sql = {
    begin: async (callback: (tx: typeof transaction) => Promise<void>) =>
      callback(transaction),
  } as unknown as postgres.Sql;
  await recordGatewayAudit(sql, {
    grantId: null,
    route: '/test',
    status: 200,
    latencyMs: 0,
  });
  expect(statements[0]).toContain("statement_timeout = '500ms'");
  expect(statements[1]).toContain("lock_timeout = '250ms'");
  expect(statements[2]).toContain('INSERT INTO public.connector_gateway_audit');
});
it('allows only one outstanding audit write and recovers after failure', async () => {
  let rejectWrite: (reason: Error) => void = () => {};
  const begin = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectWrite = reject;
        })
    )
    .mockResolvedValue(undefined);
  const audit = createGatewayAudit({ begin } as unknown as postgres.Sql);
  const input = {
    grantId: null,
    route: '/test',
    status: 200,
    started: Date.now(),
  };
  const first = audit(input);
  await audit(input);
  expect(begin).toHaveBeenCalledTimes(1);
  const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  try {
    rejectWrite(new Error('timeout'));
    await first;
    await audit(input);
  } finally {
    stderr.mockRestore();
  }
  expect(begin).toHaveBeenCalledTimes(2);
});
