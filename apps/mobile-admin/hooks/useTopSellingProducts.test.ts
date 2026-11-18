// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  chains: [] as Array<{
    table: string;
    calls: Array<{ method: string; args: unknown[] }>;
  }>,
  queryPromises: [] as Promise<unknown>[],
  rpcData: [{ id: 'prod-1', name: 'Phone', revenue: 1200, units: 3 }],
  tableResults: {
    merchant_analytics_product_costs: {
      data: [{ id: 'prod-1', cost_price: 250 }] as unknown[] | null,
      error: null as { message: string } | null,
    },
    products: {
      data: [{ id: 'prod-1', name: 'Phone', price: 400, stock_quantity: 5 }] as
        | unknown[]
        | null,
      error: null as { message: string } | null,
    },
  },
}));

function makeChain(table: 'products' | 'merchant_analytics_product_costs') {
  const record = {
    table,
    calls: [] as Array<{ method: string; args: unknown[] }>,
  };
  mocks.chains.push(record);
  const chain = Promise.resolve(
    mocks.tableResults[table]
  ) as unknown as Promise<{
    data: unknown[] | null;
    error: { message: string } | null;
  }> &
    Record<string, unknown>;
  const passthrough =
    (method: string) =>
    (...args: unknown[]) => {
      record.calls.push({ method, args });
      return chain;
    };

  for (const method of ['select', 'in', 'eq']) {
    chain[method] = passthrough(method);
  }
  return chain;
}

vi.mock('@tanstack/react-query', () => ({
  keepPreviousData: Symbol('keepPreviousData'),
  useQuery: ({
    enabled = true,
    queryFn,
  }: {
    enabled?: boolean;
    queryFn: () => Promise<unknown>;
  }) => {
    if (enabled) {
      mocks.queryPromises.push(Promise.resolve(queryFn()));
    }
    return { data: undefined, error: null, isLoading: false };
  },
}));

vi.mock('@/hooks/useMerchant', () => ({
  useMerchant: () => ({ merchant: { id: 'merchant-1' } }),
}));

vi.mock('@/lib/product-inventory', () => ({
  normalizeProductInventory: (product: Record<string, unknown>) => product,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: 'products' | 'merchant_analytics_product_costs') =>
      makeChain(table),
    rpc: () => Promise.resolve({ data: mocks.rpcData, error: null }),
  },
}));

import { useTopSellingProducts } from './useTopSellingProducts';

describe('useTopSellingProducts', () => {
  beforeEach(() => {
    mocks.chains.length = 0;
    mocks.queryPromises.length = 0;
    mocks.tableResults.products = {
      data: [{ id: 'prod-1', name: 'Phone', price: 400, stock_quantity: 5 }],
      error: null,
    };
    mocks.tableResults.merchant_analytics_product_costs = {
      data: [{ id: 'prod-1', cost_price: 250 }],
      error: null,
    };
  });

  it('hydrates public product fields from products and merges analytics cost_price without querying merchant_products', async () => {
    renderHook(() => useTopSellingProducts(10));
    const [result] = await Promise.all(mocks.queryPromises);

    expect(mocks.chains.map((chain) => chain.table)).toEqual([
      'products',
      'merchant_analytics_product_costs',
    ]);
    expect(result).toEqual([
      {
        id: 'prod-1',
        name: 'Phone',
        price: 400,
        stock_quantity: 5,
        cost_price: 250,
        totalSold: 3,
        totalRevenue: 1200,
      },
    ]);
  });

  it('retains top-selling items even when cost rows are empty', async () => {
    mocks.tableResults.merchant_analytics_product_costs = {
      data: [],
      error: null,
    };
    renderHook(() => useTopSellingProducts(10));
    const [result] = await Promise.all(mocks.queryPromises);

    expect(result).toEqual([
      {
        id: 'prod-1',
        name: 'Phone',
        price: 400,
        stock_quantity: 5,
        cost_price: null,
        totalSold: 3,
        totalRevenue: 1200,
      },
    ]);
  });
});
