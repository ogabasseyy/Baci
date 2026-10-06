import type postgres from 'postgres';
import { expect, it, vi } from 'vitest';
import { establishUserContext, resolveGrant } from './gateway';

it('fails closed when token resolution yields no live grant', async () => {
  const query = vi.fn().mockResolvedValue([]);
  await expect(
    resolveGrant(query as unknown as postgres.TransactionSql, {
      tokenHash: 'not-a-live-token',
      scope: 'orders:read',
      resource: 'orders',
      action: 'view',
      branchIds: null,
    })
  ).rejects.toThrow('connector_grant_denied');
});
it('sets claims only within the current transaction', async () => {
  const query = vi.fn().mockResolvedValue([]);
  await establishUserContext(
    query as unknown as postgres.TransactionSql,
    'linked-user'
  );
  const statements = query.mock.calls.map((call) =>
    (call[0] as TemplateStringsArray).join('?')
  );
  expect(statements[0]).toBe('SET LOCAL ROLE authenticated');
  expect(statements[1]).toContain(
    "set_config('request.jwt.claim.sub', ?, true)"
  );
  expect(statements[2]).toContain('true');
});
