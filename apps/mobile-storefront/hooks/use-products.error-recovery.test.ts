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

  it('drops the queued next page when the background refetch fails', async () => {
    mockFetchProductsPage.mockResolvedValueOnce({
      products: [createProduct('prod-1')],
      nextOffset: 1,
      total: 5,
    });
    const queryClient = createQueryClient();

    const { result } = renderHook(() => useProducts({ limit: 1 }), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.hasMore).toBe(true));

    let rejectRefetch: (() => void) | undefined;
    mockFetchProductsPage.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectRefetch = () => reject(new Error('reconnect refetch failed'));
      })
    );
    act(() => {
      void result.current.refetch();
    });
    await waitFor(() => expect(result.current.isFetching).toBe(true));

    act(() => {
      result.current.loadMore();
    });

    await act(async () => {
      rejectRefetch?.();
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    await waitFor(() => expect(result.current.isFetching).toBe(false));

    // The queued end signal dies with the failed request: no next-page
    // fetch fires, so the retained pages stay visibly stale behind the
    // refresh-retry path instead of being silently papered over.
    expect(
      mockFetchProductsPage.mock.calls.filter((call) => call[2] === 1)
    ).toHaveLength(0);
    expect(result.current.error).toBe('reconnect refetch failed');

    // Fresh intent still works: a footer retry refetches, and a later
    // scroll loads the next page.
    mockFetchProductsPage.mockResolvedValueOnce({
      products: [createProduct('prod-1')],
      nextOffset: 1,
      total: 5,
    });
    await act(async () => {
      await result.current.refetch();
    });
    await waitFor(() => expect(result.current.isError).toBe(false));
    expect(
      mockFetchProductsPage.mock.calls.filter((call) => call[2] === 1)
    ).toHaveLength(0);

    mockFetchProductsPage.mockResolvedValueOnce({
      products: [createProduct('prod-2')],
      nextOffset: null,
      total: 5,
    });
    act(() => {
      result.current.loadMore();
    });
    await waitFor(() => {
      expect(
        mockFetchProductsPage.mock.calls.filter((call) => call[2] === 1)
      ).toHaveLength(1);
    });
  });

  it('surfaces fetch errors and exposes an empty product list', async () => {
    mockFetchProductsPage.mockRejectedValueOnce(new Error('network down'));
    const queryClient = createQueryClient();

    const { result } = renderHook(() => useProducts({ limit: 3 }), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBe('network down');
    expect(result.current.products).toEqual([]);
  });
});
