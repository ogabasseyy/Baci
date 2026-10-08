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

it('marks every id unavailable when refresh fails over cached facts', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const snapshot = { id: 'p1', name: 'Phone', price: 100 } as Product;
  client.setQueryData(
    ['comparison-products', 'm1', 'p1'],
    [
      {
        product: { id: 'p1', name: 'Phone', price: 100 },
        unavailable: false,
      },
    ]
  );
  mockResolve.mockRejectedValue(new Error('offline'));
  const { result } = renderHook(() => useComparisonProducts([snapshot]), {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children),
  });
  await waitFor(() =>
    expect(result.current.status).toContain(
      'Open a product to check its current details'
    )
  );
  expect(result.current.products).toHaveLength(1);
  expect(result.current.unavailableIds).toEqual(['p1']);
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
