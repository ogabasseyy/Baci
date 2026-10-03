import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
import { createElement, type ReactNode } from 'react';
import type { Product } from '@/types/product';

const mockResolve = jest.fn();
jest.mock('./product-utils', () => ({
  resolveProductRow: (...args: unknown[]) => mockResolve(...args),
  transformProduct: (row: unknown) => row,
}));
jest.mock('./use-merchant', () => ({
  useMerchant: () => ({ data: { id: 'm1' } }),
}));

import { useComparisonProducts } from './use-comparison-products';

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
