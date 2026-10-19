import { jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { createElement, type ReactNode } from 'react';
import { fetchProductsPage } from '@/hooks/product-utils';
import { useMerchant } from '@/hooks/use-merchant';
import { useProducts } from '@/hooks/use-products';
import type { Product } from '@/types/product';

jest.mock('@/hooks/use-merchant', () => ({
  useMerchant: jest.fn(),
}));

jest.mock('@/hooks/product-utils', () => ({
  CONSTANT_MERCHANT_ID: 'merchant-fallback',
  fetchAvailableBrands: jest.fn(),
  fetchProductsPage: jest.fn(),
}));

const mockUseMerchant = useMerchant as jest.MockedFunction<typeof useMerchant>;
const mockFetchProductsPage = fetchProductsPage as jest.MockedFunction<
  typeof fetchProductsPage
>;

function createProduct(id: string, name = `Product ${id}`): Product {
  return {
    id,
    name,
    slug: `product-${id}`,
    price: 1000,
    image: `https://cdn.example.com/product-${id}.jpg`,
    images: [`https://cdn.example.com/product-${id}.jpg`],
    in_stock: true,
  };
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: Number.POSITIVE_INFINITY,
        retry: false,
      },
    },
  });
}

function createWrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('useProducts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseMerchant.mockReturnValue({
      data: { id: 'merchant-1' },
    } as ReturnType<typeof useMerchant>);
  });

  it('releases the pagination lock when the query changes mid-fetch', async () => {
    mockFetchProductsPage.mockResolvedValueOnce({
      products: [createProduct('prod-a1')],
      nextOffset: 1,
      total: 5,
    });
    const queryClient = createQueryClient();

    const { result, rerender } = renderHook(
      ({ search }: { search: string }) => useProducts({ limit: 1, search }),
      {
        initialProps: { search: 'aa' },
        wrapper: createWrapper(queryClient),
      }
    );

    await waitFor(() => expect(result.current.hasMore).toBe(true));

    // The next page for A hangs with the lock held.
    let resolveHanging: (() => void) | undefined;
    mockFetchProductsPage.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveHanging = () =>
          resolve({
            products: [createProduct('prod-a2')],
            nextOffset: null,
            total: 5,
          });
      })
    );
    act(() => {
      result.current.loadMore();
    });
    await waitFor(() => expect(result.current.isLoadingMore).toBe(true));

    // Moving to query B auto-fetches its first page; its own next-page
    // fetch must start even though A's request never settled.
    mockFetchProductsPage.mockResolvedValueOnce({
      products: [createProduct('prod-b1')],
      nextOffset: 1,
      total: 5,
    });
    rerender({ search: 'bb' });
    await waitFor(() =>
      expect(
        result.current.products.some((product) => product.id === 'prod-b1')
      ).toBe(true)
    );

    // B's next page hangs too; A's late settlement must not unlock it.
    let resolveHangingB: (() => void) | undefined;
    mockFetchProductsPage.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveHangingB = () =>
          resolve({
            products: [createProduct('prod-b2')],
            nextOffset: null,
            total: 5,
          });
      })
    );
    act(() => {
      result.current.loadMore();
    });

    await waitFor(() => {
      expect(mockFetchProductsPage).toHaveBeenLastCalledWith(
        'merchant-1',
        { limit: 1, search: 'bb' },
        1
      );
    });

    const callsBeforeLateSettle = mockFetchProductsPage.mock.calls.length;
    await act(async () => {
      resolveHanging?.();
    });

    // A's obsolete release is key-guarded, so B's lock still holds and a
    // second end signal starts no duplicate B request.
    act(() => {
      result.current.loadMore();
    });
    expect(mockFetchProductsPage.mock.calls.length).toBe(callsBeforeLateSettle);

    await act(async () => {
      resolveHangingB?.();
    });
    await waitFor(() =>
      expect(
        result.current.products.some((product) => product.id === 'prod-b2')
      ).toBe(true)
    );
  });
});
