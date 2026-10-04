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

import { useComparisonProducts } from './use-comparison-products';

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

it('fails closed when the purchasable projection errors', async () => {
  mockResolve.mockResolvedValue({
    id: 'p1',
    name: 'Phone',
    price: 100,
    manage_stock: true,
    variants: [{ id: 'v1', price: 200, stock_quantity: 5 }],
  });
  mockRpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
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
  await waitFor(() =>
    expect(result.current.status).toContain(
      'Open a product to check its current details'
    )
  );
  expect(result.current.unavailableIds).toEqual(['p1']);
});

it('allows an unmanaged offer even when scalar stock is zero', async () => {
  mockResolve.mockResolvedValue({
    id: 'p1',
    name: 'Phone',
    price: 100,
    manage_stock: false,
    offers: [{ id: 'o1', price: 200, stock_quantity: 0 }],
  });
  mockRpc.mockResolvedValue({
    data: [{ variant_id: null, offer_id: 'o1' }],
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
          searchMatch: { offerId: 'o1' },
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

it('refreshes merchant-scoped snapshots and keeps matched identities without mutating selection', async () => {
  const snapshot = {
    id: 'p1',
    slug: 'iphone',
    name: 'iPhone',
    price: 100,
    searchMatch: { variantId: 'v1' },
  } as Product;
  mockResolve.mockResolvedValue({
    id: 'p1',
    price: 150,
    stock_quantity: 1,
    manage_stock: true,
    name: 'iPhone',
    variants: [
      {
        id: 'v1',
        price: 175,
        condition: 'used',
        attributes: { storage: '128 GB' },
      },
    ],
  });
  mockRpc.mockResolvedValue({
    data: [{ variant_id: 'v1', offer_id: null }],
    error: null,
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const { result } = renderHook(() => useComparisonProducts([snapshot]), {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children),
  });
  await waitFor(() => expect(result.current.products[0].price).toBe(175));
  expect(mockResolve).toHaveBeenCalledWith('m1', 'p1');
  expect(result.current.products[0].searchMatch?.variantId).toBe('v1');
  expect(snapshot.price).toBe(100);
});
it('suppresses deleted products rather than reporting their saved price as current', async () => {
  mockResolve.mockResolvedValue(null);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const { result } = renderHook(
    () =>
      useComparisonProducts([
        {
          id: 'gone',
          slug: 'gone',
          image: '',
          images: [],
          name: 'Deleted',
          price: 900,
          compare_at_price: 1200,
          rating: 4.8,
          specifications: { RAM: '8 GB' },
        } as Product,
      ]),
    {
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client }, children),
    }
  );
  await waitFor(() => expect(result.current.status).toContain('unavailable'));
  expect(result.current.unavailableIds).toEqual(['gone']);
  expect(result.current.products[0].price).toBe(0);
  expect(result.current.products[0].specifications).toBeUndefined();
  expect(result.current.products[0].compare_at_price).toBeUndefined();
  expect(result.current.products[0].rating).toBeUndefined();
});
it('marks loading ids unverified so the zero fallback price is never shown as current', () => {
  mockResolve.mockReturnValue(new Promise(() => {}));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const { result } = renderHook(
    () =>
      useComparisonProducts([
        { id: 'p1', slug: 'p1', name: 'Phone', price: 100 } as Product,
      ]),
    {
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client }, children),
    }
  );
  expect(result.current.products[0].price).toBe(0);
  expect(result.current.unavailableIds).toEqual(['p1']);
  expect(result.current.status).toContain('Refreshing');
});

it.each([
  'variant',
  'offer',
] as const)('refreshes a different matched %s for the same parent product', async (kind) => {
  const row = {
    id: 'p1',
    name: 'Phone',
    price: 100,
    manage_stock: true,
    variants: [
      { id: 'v1', price: 150, stock_quantity: 1 },
      { id: 'v2', price: 250, stock_quantity: 1 },
    ],
    offers: [
      { id: 'o1', price: 150, stock_quantity: 1 },
      { id: 'o2', price: 250, stock_quantity: 1 },
    ],
  };
  mockResolve.mockResolvedValue(row);
  mockRpc.mockResolvedValue({
    data: [
      { variant_id: 'v1', offer_id: null },
      { variant_id: 'v2', offer_id: null },
      { variant_id: null, offer_id: 'o1' },
      { variant_id: null, offer_id: 'o2' },
    ],
    error: null,
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const selected = (n: number) => [
    {
      id: 'p1',
      name: 'Phone',
      price: 100,
      searchMatch:
        kind === 'variant' ? { variantId: `v${n}` } : { offerId: `o${n}` },
    } as Product,
  ];
  const { result, rerender } = renderHook(
    ({ items }: { items: Product[] }) => useComparisonProducts(items),
    {
      initialProps: { items: selected(1) },
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client }, children),
    }
  );
  await waitFor(() => expect(result.current.products[0].price).toBe(150));
  rerender({ items: selected(2) });
  await waitFor(() => expect(result.current.products[0].price).toBe(250));
  expect(mockResolve).toHaveBeenCalledTimes(2);
});
