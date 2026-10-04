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

  it('queues the next page when loadMore fires during a background refetch', async () => {
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

    // The refetch hangs so the query stays in a background-fetching state.
    let resolveHanging: (() => void) | undefined;
    mockFetchProductsPage.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveHanging = () =>
          resolve({
            products: [createProduct('prod-1')],
            nextOffset: 1,
            total: 5,
          });
      })
    );

    act(() => {
      void result.current.refetch();
    });

    await waitFor(() => expect(result.current.isFetching).toBe(true));

    const callsBeforeLoadMore = mockFetchProductsPage.mock.calls.length;
    act(() => {
      result.current.loadMore();
    });

    expect(mockFetchProductsPage.mock.calls.length).toBe(callsBeforeLoadMore);

    mockFetchProductsPage.mockResolvedValueOnce({
      products: [createProduct('prod-2')],
      nextOffset: null,
      total: 5,
    });

    resolveHanging?.();

    await waitFor(() => {
      expect(mockFetchProductsPage.mock.calls.length).toBe(
        callsBeforeLoadMore + 1
      );
    });
    expect(mockFetchProductsPage).toHaveBeenLastCalledWith(
      'merchant-1',
      { limit: 1 },
      1
    );
  });

  it('starts one next-page fetch for synchronous duplicate loadMore calls', async () => {
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

    mockFetchProductsPage.mockResolvedValueOnce({
      products: [createProduct('prod-2')],
      nextOffset: 2,
      total: 5,
    });

    const callsBeforeLoadMore = mockFetchProductsPage.mock.calls.length;
    act(() => {
      // Two end-reached signals before any rerender: both see the same
      // stale fetching flags, so only the synchronous lock dedupes them.
      result.current.loadMore();
      result.current.loadMore();
    });

    await waitFor(() => {
      expect(mockFetchProductsPage.mock.calls.length).toBe(
        callsBeforeLoadMore + 1
      );
    });
    expect(mockFetchProductsPage).toHaveBeenLastCalledWith(
      'merchant-1',
      { limit: 1 },
      1
    );

    // The lock releases once the fetch settles: a later signal fetches again.
    await waitFor(() =>
      expect(
        result.current.products.some((product) => product.id === 'prod-2')
      ).toBe(true)
    );
    mockFetchProductsPage.mockResolvedValueOnce({
      products: [createProduct('prod-3')],
      nextOffset: null,
      total: 5,
    });

    act(() => {
      result.current.loadMore();
    });

    await waitFor(() => {
      expect(mockFetchProductsPage.mock.calls.length).toBe(
        callsBeforeLoadMore + 2
      );
    });
  });
});
