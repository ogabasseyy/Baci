import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimeSeriesDataPoint } from './useAnalyticsDetail.types';

const mocks = vi.hoisted(() => {
  type ChainCall = { method: string; args: unknown[] };
  const chains: Array<{
    calls: ChainCall[];
    result: { data: unknown[] | null; error: { message: string } | null };
    table: string;
  }> = [];

  function makeChain(table: string) {
    const record = {
      calls: [] as ChainCall[],
      result: { data: [], error: null as { message: string } | null },
      table,
    };
    chains.push(record);
    const chain = Promise.resolve(record.result) as Promise<
      typeof record.result
    > &
      Record<string, unknown>;
    const passthrough =
      (method: string) =>
      (...args: unknown[]) => {
        record.calls.push({ method, args });
        return chain;
      };

    for (const method of ['select', 'eq', 'gte', 'lte']) {
      chain[method] = passthrough(method);
    }
    return chain;
  }

  return {
    aggregateAnalyticsDetail: vi.fn(),
    chains,
    from: vi.fn((table: string) => makeChain(table)),
    reset: () => {
      chains.length = 0;
    },
  };
});

vi.mock('@/lib/supabase', () => ({
  supabase: { from: mocks.from },
}));

vi.mock('./useAnalyticsDetail.aggregate', () => ({
  aggregateAnalyticsDetail: mocks.aggregateAnalyticsDetail,
}));

import { fetchAnalyticsDetailComparison } from './useAnalyticsDetail.comparison';

const dataPoint: TimeSeriesDataPoint = {
  count: 1,
  label: 'Jan',
  secondaryValue: 0,
  value: 100,
};

function setAggregateTotal(total: number) {
  mocks.aggregateAnalyticsDetail.mockReturnValue({
    bestPeriod: dataPoint,
    data: [dataPoint],
    total,
    worstPeriod: dataPoint,
  });
}

function args(
  metric: 'revenue' | 'sales' | 'aov' | 'profits' | 'vat',
  total = 200
) {
  return {
    endDateValue: new Date('2026-02-28T00:00:00.000Z'),
    granularity: 'month' as const,
    merchantId: 'merchant-1',
    metric,
    scope: { type: 'branch' as const, branchId: 'branch-1' },
    startDateValue: new Date('2026-02-01T00:00:00.000Z'),
    timezone: 'UTC',
    total,
  };
}

describe('fetchAnalyticsDetailComparison', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.reset();
    setAggregateTotal(100);
  });

  it('applies branch scope to comparison orders and order items for revenue metrics', async () => {
    await fetchAnalyticsDetailComparison(args('revenue'));

    expect(mocks.from).toHaveBeenCalledWith('orders');
    expect(mocks.from).toHaveBeenCalledWith('order_items');
    expect(
      mocks.chains.find((chain) => chain.table === 'orders')?.calls
    ).toEqual(
      expect.arrayContaining([
        { method: 'eq', args: ['branch_id', 'branch-1'] },
      ])
    );
    expect(
      mocks.chains.find((chain) => chain.table === 'order_items')?.calls
    ).toEqual(
      expect.arrayContaining([
        { method: 'eq', args: ['orders.branch_id', 'branch-1'] },
      ])
    );
    const orderItemsSelect = mocks.chains
      .find((chain) => chain.table === 'order_items')
      ?.calls.find((call) => call.method === 'select')?.args[0];
    expect(orderItemsSelect).toEqual(expect.stringContaining('cost_price'));
    expect(orderItemsSelect).toEqual(
      expect.stringContaining('product_variants(cost_price)')
    );
    expect(orderItemsSelect).toEqual(
      expect.stringContaining('order_item_unit_costs(cost_price, unit_index)')
    );
    expect(orderItemsSelect).not.toEqual(
      expect.stringContaining('products!inner(cost_price)')
    );
  });

  it('does not query order items for non-revenue metrics or all-location scope', async () => {
    await fetchAnalyticsDetailComparison({
      ...args('sales'),
      scope: { type: 'all' },
    });

    expect(mocks.from).toHaveBeenCalledWith('orders');
    expect(mocks.from).not.toHaveBeenCalledWith('order_items');
    const branchScopedChain = mocks.chains.find((chain) =>
      chain.calls.some((call) => call.args[0] === 'branch_id')
    );
    expect(branchScopedChain).toBeUndefined();
  });

  it('throws comparison order errors with the expected prefix', async () => {
    const promise = fetchAnalyticsDetailComparison(args('sales'));
    const ordersChain = mocks.chains.find((chain) => chain.table === 'orders');
    expect(ordersChain).toBeDefined();
    if (!ordersChain) return;
    ordersChain.result.error = { message: 'orders failed' };

    await expect(promise).rejects.toThrow(
      'Failed to fetch comparison orders: orders failed'
    );
  });

  it('throws comparison order-item errors with the expected prefix', async () => {
    const promise = fetchAnalyticsDetailComparison(args('profits'));
    const orderItemsChain = mocks.chains.find(
      (chain) => chain.table === 'order_items'
    );
    expect(orderItemsChain).toBeDefined();
    if (!orderItemsChain) return;
    orderItemsChain.result.error = { message: 'items failed' };

    await expect(promise).rejects.toThrow(
      'Failed to fetch comparison order items: items failed'
    );
  });

  it('returns 100% when comparison total is zero and current total is positive', async () => {
    setAggregateTotal(0);
    await expect(
      fetchAnalyticsDetailComparison(args('sales', 50))
    ).resolves.toMatchObject({ percentChange: 100 });
  });

  it('returns 0% when both comparison and current totals are zero', async () => {
    setAggregateTotal(0);
    await expect(
      fetchAnalyticsDetailComparison(args('sales', 0))
    ).resolves.toMatchObject({ percentChange: 0 });
  });

  it('returns 100% when comparison total is negative', async () => {
    setAggregateTotal(-100);
    await expect(
      fetchAnalyticsDetailComparison(args('sales', 50))
    ).resolves.toMatchObject({ percentChange: 100 });
  });
});
