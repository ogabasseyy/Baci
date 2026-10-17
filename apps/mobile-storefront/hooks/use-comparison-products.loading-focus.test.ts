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
let mockIsFocused = true;
jest.mock('expo-router', () => ({
  useIsFocused: () => mockIsFocused,
}));

import { useComparisonProducts } from './use-comparison-products';

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

it('refetches facts when the screen regains focus, without double-fetching on mount', async () => {
  mockIsFocused = true;
  mockResolve.mockResolvedValue({
    id: 'p1',
    name: 'Phone',
    price: 150,
    manage_stock: false,
  });
  mockRpc.mockResolvedValue({ data: [], error: null });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const items = [{ id: 'p1', name: 'Phone', price: 100 } as Product];
  const { result, rerender } = renderHook(
    ({ focused }: { focused: boolean }) => {
      mockIsFocused = focused;
      return useComparisonProducts(items);
    },
    {
      initialProps: { focused: true },
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client }, children),
    }
  );
  await waitFor(() => expect(result.current.products[0].price).toBe(150));
  // Mount stays single-fetch: focus was already true on first render.
  expect(mockResolve).toHaveBeenCalledTimes(1);
  // Pushing a PDP blurs the still-mounted screen; returning refocuses it.
  rerender({ focused: false });
  rerender({ focused: true });
  await waitFor(() => expect(mockResolve).toHaveBeenCalledTimes(2));
  mockIsFocused = true;
});
