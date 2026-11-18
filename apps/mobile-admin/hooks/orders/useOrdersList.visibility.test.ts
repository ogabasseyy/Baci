import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryCalls = vi.hoisted(() => {
  const calls: Array<{ args: unknown[]; method: string }> = [];
  const chain: Record<string, unknown> = {};
  for (const method of [
    'select',
    'eq',
    'not',
    'or',
    'gte',
    'lte',
    'order',
    'range',
  ]) {
    chain[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return chain;
    };
  }
  Object.defineProperty(chain, 'then', {
    value: (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ count: 0, data: [], error: null }).then(resolve),
  });
  return { calls, chain };
});

vi.mock('@/lib/supabase', () => ({
  supabase: { from: () => queryCalls.chain },
}));

vi.mock('@/lib/orders', () => ({ ORDER_COLUMNS: 'id, order_items(id)' }));

vi.mock('@/lib/sanitize', () => ({
  sanitizeText: (value: string) => value.trim(),
}));

vi.mock('@/schemas/branch', () => ({ ALL_BRANCH_SCOPE: { type: 'all' } }));

vi.mock('../useBranchScope', () => ({
  useBranchScope: () => ({ scope: { type: 'all' } }),
}));

vi.mock('../useMerchant', () => ({
  useMerchant: () => ({ merchant: { id: 'merchant-1' } }),
}));

import { ORDER_LIST_VISIBILITY_FILTER } from './order-list-visibility';
import { fetchOrders } from './useOrdersList';

describe('fetchOrders visibility', () => {
  beforeEach(() => {
    queryCalls.calls.length = 0;
  });

  it('applies the order list visibility rules to the orders query', async () => {
    await fetchOrders('merchant-1', 0, {}, { type: 'all' });

    expect(queryCalls.calls).toContainEqual({
      method: 'or',
      args: [ORDER_LIST_VISIBILITY_FILTER],
    });
    expect(queryCalls.calls.some((call) => call.method === 'not')).toBe(false);
  });
});
