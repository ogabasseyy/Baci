import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
import { createElement, type ReactNode } from 'react';
import type { Product } from '@/types/product';

const mockResolve = jest.fn();
const mockRpc = jest.fn();
beforeEach(() => {
  mockResolve.mockReset();
  mockRpc.mockReset();
});
jest.mock('./product-utils', () => ({
  resolveProductRow: (...args: unknown[]) => mockResolve(...args),
  // Mirror the production transform's null-to-false normalization.
  transformProduct: (row: unknown) =>
    row && typeof row === 'object' && 'manage_stock' in row
      ? { ...row, manage_stock: row.manage_stock ?? false }
      : row,
}));
jest.mock('./use-merchant', () => ({
  useMerchant: () => ({ data: { id: 'm1' } }),
}));
jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));
jest.mock('@/lib/api', () => ({
  withSupabaseRetry: (fn: () => Promise<unknown>) => fn(),
}));
const mockIsFocused = true;
jest.mock('expo-router', () => ({
  useIsFocused: () => mockIsFocused,
}));

import { useComparisonProducts } from './use-comparison-products';

it.each([
  'variant',
  'offer',
  'base',
] as const)('refreshes the condition used by %s detail links', async (kind) => {
  const match = {
    price: 100,
    condition: 'new',
    ...(kind === 'variant'
      ? { variantId: 'v1' }
      : kind === 'offer'
        ? { offerId: 'o1' }
        : {}),
  };
  mockResolve.mockResolvedValue({
    id: 'p1',
    name: 'Phone',
    price: 200,
    // Mirrors the production transform's aggregate label for simple
    // products with condition offers.
    condition: 'New & Used',
    variants: [{ id: 'v1', condition: 'used', price: 200 }],
    offers: [{ id: 'o1', condition: 'used', price: 200 }],
  });
  mockRpc.mockResolvedValue({
    data: [
      {
        variant_id: kind === 'variant' ? 'v1' : null,
        offer_id: kind === 'offer' ? 'o1' : null,
        condition: 'used',
      },
    ],
    error: null,
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const snapshot = {
    id: 'p1',
    name: 'Phone',
    price: 100,
    searchMatch: match,
  } as Product;
  const { result } = renderHook(() => useComparisonProducts([snapshot]), {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children),
  });
  await waitFor(() =>
    expect(result.current.products[0].searchMatch?.condition).toBe('used')
  );
  expect(result.current.products[0].searchMatch).toMatchObject({
    ...match,
    condition: 'used',
  });
  // The compare table reads product.condition, so a base-row refresh must
  // replace the aggregate label with the live condition too.
  expect(result.current.products[0].condition).toBe('used');
  expect(result.current.unavailableIds).toEqual([]);
  expect(snapshot.searchMatch?.condition).toBe('new');
});

it('prefers the verified projection price over the hydrated option price', async () => {
  mockResolve.mockResolvedValue({
    id: 'p1',
    name: 'Phone',
    price: 200,
    condition: 'New & Used',
    variants: [{ id: 'v1', condition: 'used', price: 200 }],
    offers: [],
  });
  mockRpc.mockResolvedValue({
    data: [
      {
        variant_id: 'v1',
        offer_id: null,
        condition: 'used',
        effective_price: 150,
      },
    ],
    error: null,
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const { result } = renderHook(
    () =>
      useComparisonProducts([
        {
          id: 'p1',
          name: 'Phone',
          price: 100,
          searchMatch: { price: 150, condition: 'used', variantId: 'v1' },
        } as Product,
      ]),
    {
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client }, children),
    }
  );
  await waitFor(() => expect(result.current.products[0].price).toBe(150));
  expect(result.current.unavailableIds).toEqual([]);
});

it('labels a degraded exact-variant match with the verified live condition', async () => {
  // Degraded hydration returns the parent row without the matched
  // variant, while the price projection still verifies the exact id.
  mockResolve.mockResolvedValue({
    id: 'p1',
    name: 'Phone',
    price: 200,
    condition: 'New & Used',
    variants: [],
    offers: [],
  });
  mockRpc.mockResolvedValue({
    data: [
      {
        variant_id: 'v1',
        offer_id: null,
        condition: 'used',
        effective_price: 150,
      },
    ],
    error: null,
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const { result } = renderHook(
    () =>
      useComparisonProducts([
        {
          id: 'p1',
          name: 'Phone',
          price: 100,
          searchMatch: { price: 150, condition: 'used', variantId: 'v1' },
        } as Product,
      ]),
    {
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client }, children),
    }
  );
  await waitFor(() =>
    expect(result.current.products[0].condition).toBe('used')
  );
  expect(result.current.products[0].price).toBe(150);
  expect(result.current.products[0].specifications).toEqual({});
  expect(result.current.unavailableIds).toEqual([]);
});

it.each([
  false,
  true,
])('revalidates a matched base row (available=%s)', async (available) => {
  mockResolve.mockResolvedValue({
    id: 'p1',
    name: 'Phone',
    price: 175,
    manage_stock: true,
    stock_quantity: available ? 1 : 0,
  });
  mockRpc.mockResolvedValue({
    data: available ? [{ variant_id: null, offer_id: null }] : [],
    error: null,
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const { result } = renderHook(
    () =>
      useComparisonProducts([
        {
          id: 'p1',
          name: 'Phone',
          price: 100,
          searchMatch: { price: 100, condition: 'new' },
        } as Product,
      ]),
    {
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client }, children),
    }
  );
  await waitFor(() =>
    expect(result.current.status).not.toContain('Refreshing')
  );
  expect(result.current.unavailableIds).toEqual(available ? [] : ['p1']);
  expect(result.current.products[0].price).toBe(available ? 175 : 0);
  expect(mockRpc).toHaveBeenCalledWith('get_storefront_search_price_options', {
    p_merchant_id: 'm1',
    p_product_id: 'p1',
  });
});

it.each([
  { kind: 'variant', rpcOptions: [] },
  { kind: 'variant', rpcOptions: [{ variant_id: 'v2', offer_id: null }] },
  { kind: 'offer', rpcOptions: [] },
  { kind: 'offer', rpcOptions: [{ variant_id: null, offer_id: 'o2' }] },
] as const)('marks exact options the purchasable projection omits unavailable %#', async (fixture) => {
  const searchMatch =
    fixture.kind === 'variant' ? { variantId: 'v1' } : { offerId: 'o1' };
  // Raw stock is healthy here: omission from the serialized-aware
  // projection alone must drive the unavailable verdict.
  mockResolve.mockResolvedValue({
    id: 'p1',
    name: 'Phone',
    price: 100,
    manage_stock: true,
    stock_quantity: 5,
    ...(fixture.kind === 'variant'
      ? { variants: [{ id: 'v1', price: 200, stock_quantity: 5 }] }
      : { offers: [{ id: 'o1', price: 200, stock_quantity: 5 }] }),
  });
  mockRpc.mockResolvedValue({ data: fixture.rpcOptions, error: null });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const { result } = renderHook(
    () =>
      useComparisonProducts([
        {
          id: 'p1',
          name: 'Phone',
          price: 100,
          searchMatch,
        } as Product,
      ]),
    {
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client }, children),
    }
  );
  await waitFor(() => expect(result.current.status).toContain('unavailable'));
  expect(result.current.unavailableIds).toEqual(['p1']);
  expect(mockRpc).toHaveBeenCalledWith('get_storefront_search_price_options', {
    p_merchant_id: 'm1',
    p_product_id: 'p1',
  });
});

it('keeps a zero-raw-stock serialized option available when the projection includes it', async () => {
  mockResolve.mockResolvedValue({
    id: 'p1',
    name: 'Phone',
    price: 100,
    manage_stock: true,
    stock_quantity: 0,
    variants: [{ id: 'v1', price: 200, stock_quantity: 0 }],
  });
  mockRpc.mockResolvedValue({
    data: [{ variant_id: 'v1', offer_id: null }],
    error: null,
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const { result } = renderHook(
    () =>
      useComparisonProducts([
        {
          id: 'p1',
          name: 'Phone',
          price: 100,
          searchMatch: { variantId: 'v1' },
        } as Product,
      ]),
    {
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client }, children),
    }
  );
  await waitFor(() => expect(result.current.products[0].price).toBe(200));
  expect(result.current.unavailableIds).toEqual([]);
});

it('suppresses the parent strike-through when a matched option reprices', async () => {
  mockResolve.mockResolvedValue({
    id: 'p1',
    name: 'Phone',
    price: 100,
    compare_at_price: 1200,
    manage_stock: true,
    variants: [{ id: 'v1', price: 500, stock_quantity: 5 }],
  });
  mockRpc.mockResolvedValue({
    data: [{ variant_id: 'v1', offer_id: null }],
    error: null,
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const { result } = renderHook(
    () =>
      useComparisonProducts([
        {
          id: 'p1',
          name: 'Phone',
          price: 100,
          searchMatch: { variantId: 'v1' },
        } as Product,
      ]),
    {
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client }, children),
    }
  );
  await waitFor(() => expect(result.current.products[0].price).toBe(500));
  expect(result.current.products[0].compare_at_price).toBeUndefined();
  expect(result.current.unavailableIds).toEqual([]);
});

it('keeps the parent strike-through when no option matched', async () => {
  mockResolve.mockResolvedValue({
    id: 'p1',
    name: 'Phone',
    price: 100,
    compare_at_price: 1200,
    manage_stock: true,
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const { result } = renderHook(
    () =>
      useComparisonProducts([
        { id: 'p1', name: 'Phone', price: 100 } as Product,
      ]),
    {
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client }, children),
    }
  );
  await waitFor(() => expect(result.current.products[0].price).toBe(100));
  expect(result.current.products[0].compare_at_price).toBe(1200);
  expect(mockRpc).not.toHaveBeenCalled();
});
