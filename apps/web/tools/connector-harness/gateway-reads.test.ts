import type postgres from 'postgres';
import { expect, it, vi } from 'vitest';
import {
  readAnalyticsSummary,
  readOrderGet,
  readOrdersList,
} from './gateway-reads';
import type { HarnessGrantContext } from './gateway-types';

const context: HarnessGrantContext = {
  grantId: 'g',
  userId: 'u',
  merchantId: 'm',
  branchIds: ['a'],
  merchantWide: true,
  scopes: ['orders:read'],
  grantVersion: 1,
};
it('narrows merchant-wide reads to the requested branch and bounds the result count', async () => {
  const query = vi.fn().mockResolvedValue([]);
  expect(
    await readOrdersList(
      query as unknown as postgres.TransactionSql,
      context,
      ['b'],
      500
    )
  ).toEqual([]);
  expect(query.mock.calls[0].slice(1)).toEqual(['m', ['b'], 50]);
});
it('treats invisible orders as absent', async () => {
  const query = vi.fn().mockResolvedValue([]);
  expect(
    await readOrderGet(
      query as unknown as postgres.TransactionSql,
      context,
      'foreign-order'
    )
  ).toBeNull();
});

it('does not assign a currency or scalar total to unknown-currency revenue', async () => {
  const query = vi
    .fn()
    .mockResolvedValueOnce([
      { currency: null, count: 1, paidCount: 1, paidRevenue: 9 },
    ])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([]);
  const summary = await readAnalyticsSummary(
    query as unknown as postgres.TransactionSql,
    context,
    null
  );
  expect(summary.orders).toMatchObject({
    paidRevenue: null,
    currency: null,
    paidRevenueByCurrency: [{ currency: null, amount: 9 }],
  });
});
