import { describe, expect, it } from 'vitest';
import { fetchMerchantAnalyticsData } from '@/lib/merchant-analytics-queries';

function createSupabaseMock() {
  const chains: Array<{
    table: string;
    calls: Array<{ method: string; args: unknown[] }>;
  }> = [];
  const rpcCalls: Array<{
    functionName: string;
    args: Record<string, unknown>;
  }> = [];
  const chainErrors: Partial<Record<string, Error>> = {};

  function makeChain(table: string) {
    const record = {
      table,
      calls: [] as Array<{ method: string; args: unknown[] }>,
    };
    chains.push(record);
    const error = chainErrors[table] ?? null;
    const chain = Promise.resolve({
      count: 0,
      data: error ? null : ([] as unknown[]),
      error,
    }) as unknown as Promise<{
      count: number;
      data: unknown[] | null;
      error: Error | null;
    }> &
      Record<string, unknown>;
    const passthrough =
      (method: string) =>
      (...args: unknown[]) => {
        record.calls.push({ method, args });
        return chain;
      };

    for (const method of ['select', 'eq', 'gte', 'lte', 'order', 'limit']) {
      chain[method] = passthrough(method);
    }
    return chain;
  }

  return {
    chains,
    rpcCalls,
    setChainError: (table: string, error: Error) => {
      chainErrors[table] = error;
    },
    from: (table: string) => makeChain(table),
    rpc: (functionName: string, args: Record<string, unknown>) => {
      rpcCalls.push({ functionName, args });
      return Promise.resolve({ data: [], error: null });
    },
  };
}

describe('fetchMerchantAnalyticsData', () => {
  it('filters only order-backed analytics queries by branch id', async () => {
    const supabase = createSupabaseMock();

    await fetchMerchantAnalyticsData(
      supabase as never,
      'merchant-1',
      new Date('2026-05-01T00:00:00.000Z'),
      new Date('2026-05-05T00:00:00.000Z'),
      new Date('2026-04-26T00:00:00.000Z'),
      new Date('2026-04-30T00:00:00.000Z'),
      'branch-1'
    );

    expect(
      supabase.chains.flatMap((chain) =>
        chain.calls
          .filter(
            (call) =>
              call.method === 'eq' &&
              (call.args[0] === 'branch_id' ||
                call.args[0] === 'orders.branch_id')
          )
          .map((call) => ({
            table: chain.table,
            column: call.args[0],
            value: call.args[1],
          }))
      )
    ).toEqual([
      { table: 'orders', column: 'branch_id', value: 'branch-1' },
      { table: 'orders', column: 'branch_id', value: 'branch-1' },
      {
        table: 'order_items',
        column: 'orders.branch_id',
        value: 'branch-1',
      },
      {
        table: 'order_items',
        column: 'orders.branch_id',
        value: 'branch-1',
      },
      { table: 'orders', column: 'branch_id', value: 'branch-1' },
      { table: 'orders', column: 'branch_id', value: 'branch-1' },
    ]);

    const blogQuery = supabase.chains.find(
      (chain) => chain.table === 'blog_posts'
    );
    expect(
      blogQuery?.calls.filter((call) => call.args[0] === 'branch_id')
    ).toEqual([]);
  });

  it('propagates Supabase query errors to the caller', async () => {
    const supabase = createSupabaseMock();
    supabase.setChainError('orders', new Error('boom'));

    const results = await fetchMerchantAnalyticsData(
      supabase as never,
      'merchant-1',
      new Date('2026-05-01T00:00:00.000Z'),
      new Date('2026-05-05T00:00:00.000Z'),
      new Date('2026-04-26T00:00:00.000Z'),
      new Date('2026-04-30T00:00:00.000Z')
    );

    expect(results.currentOrdersResult.error).toEqual(new Error('boom'));
  });

  it('selects transaction item and variant costs for profit analytics', async () => {
    const supabase = createSupabaseMock();

    await fetchMerchantAnalyticsData(
      supabase as never,
      'merchant-1',
      new Date('2026-05-01T00:00:00.000Z'),
      new Date('2026-05-05T00:00:00.000Z'),
      new Date('2026-04-26T00:00:00.000Z'),
      new Date('2026-04-30T00:00:00.000Z')
    );

    const orderItemSelects = supabase.chains
      .filter((chain) => chain.table === 'order_items')
      .map(
        (chain) => chain.calls.find((call) => call.method === 'select')?.args[0]
      );

    expect(orderItemSelects).toHaveLength(2);
    for (const select of orderItemSelects) {
      expect(select).toEqual(expect.stringContaining('cost_price'));
      expect(select).toEqual(
        expect.stringContaining('product_variants(cost_price)')
      );
      expect(select).toEqual(
        expect.stringContaining('products:merchant_products(brand, cost_price)')
      );
    }
  });

  it('loads supplier purchase analytics with the same date and branch scope', async () => {
    const supabase = createSupabaseMock();
    const startDate = new Date('2026-05-01T00:00:00.000Z');
    const endDate = new Date('2026-05-05T00:00:00.000Z');

    await fetchMerchantAnalyticsData(
      supabase as never,
      'merchant-1',
      startDate,
      endDate,
      new Date('2026-04-26T00:00:00.000Z'),
      new Date('2026-04-30T00:00:00.000Z'),
      'branch-1'
    );

    expect(supabase.rpcCalls).toEqual([
      {
        functionName: 'get_supplier_purchase_analytics',
        args: {
          p_branch_id: 'branch-1',
          p_end_date: endDate.toISOString(),
          p_merchant_id: 'merchant-1',
          p_start_date: startDate.toISOString(),
        },
      },
    ]);
  });
});
