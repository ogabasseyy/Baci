import { jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { createElement, type ReactNode } from 'react';
import { fetchAvailableBrands, fetchProductsPage } from '@/hooks/product-utils';
import { useMerchant } from '@/hooks/use-merchant';
import { useProductBrands, useProducts } from '@/hooks/use-products';
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
const mockFetchAvailableBrands = fetchAvailableBrands as jest.MockedFunction<
  typeof fetchAvailableBrands
>;
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

describe('useProductBrands', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseMerchant.mockReturnValue({
      data: { id: 'merchant-1' },
    } as ReturnType<typeof useMerchant>);
  });

  it('fetches brand options with the current merchant id', async () => {
    mockFetchAvailableBrands.mockResolvedValue(['Infinix', 'Samsung']);
    const queryClient = createQueryClient();

    const { result } = renderHook(
      () =>
        useProductBrands({
          category: 'phones',
          condition: 'Open Box',
        }),
      {
        wrapper: createWrapper(queryClient),
      }
    );

    await waitFor(() => {
      expect(result.current.brands).toEqual(['Infinix', 'Samsung']);
    });

    expect(mockFetchAvailableBrands).toHaveBeenCalledWith('merchant-1', {
      category: 'phones',
      condition: 'Open Box',
    });
  });
});

describe('useProducts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseMerchant.mockReturnValue({
      data: { id: 'merchant-1' },
    } as ReturnType<typeof useMerchant>);
  });

  it('deduplicates products by id before exposing flattened pages', async () => {
    mockFetchProductsPage.mockResolvedValue({
      products: [
        createProduct('prod-1', 'First iPhone'),
        createProduct('prod-1', 'Duplicate iPhone'),
        createProduct('prod-2', 'Pixel 8'),
      ],
      nextOffset: null,
      total: 3,
    });
    const queryClient = createQueryClient();

    const { result } = renderHook(() => useProducts({ limit: 3 }), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.products).toEqual([
        createProduct('prod-1', 'First iPhone'),
        createProduct('prod-2', 'Pixel 8'),
      ]);
    });
  });

  it('does not refetch fresh product pages on remount', async () => {
    mockFetchProductsPage.mockResolvedValue({
      products: [
        createProduct('prod-1', 'First iPhone'),
        createProduct('prod-2', 'Pixel 8'),
      ],
      nextOffset: null,
      total: 2,
    });
    const queryClient = createQueryClient();
    const wrapper = createWrapper(queryClient);

    const firstRender = renderHook(() => useProducts({ limit: 3 }), {
      wrapper,
    });

    await waitFor(() => {
      expect(firstRender.result.current.products).toHaveLength(2);
    });

    firstRender.unmount();

    const secondRender = renderHook(() => useProducts({ limit: 3 }), {
      wrapper,
    });

    await waitFor(() => {
      expect(secondRender.result.current.products).toHaveLength(2);
    });

    expect(mockFetchProductsPage).toHaveBeenCalledTimes(1);
  });

  it('does not refetch stale cached product pages on remount', async () => {
    mockFetchProductsPage.mockResolvedValue({
      products: [
        createProduct('prod-1', 'First iPhone'),
        createProduct('prod-2', 'Pixel 8'),
      ],
      nextOffset: null,
      total: 2,
    });
    const queryClient = createQueryClient();
    const wrapper = createWrapper(queryClient);

    const firstRender = renderHook(() => useProducts({ limit: 3 }), {
      wrapper,
    });

    await waitFor(() => {
      expect(firstRender.result.current.products).toHaveLength(2);
    });

    firstRender.unmount();
    await queryClient.invalidateQueries({
      queryKey: ['products', 'merchant-1'],
    });

    const secondRender = renderHook(() => useProducts({ limit: 3 }), {
      wrapper,
    });

    await waitFor(() => {
      expect(secondRender.result.current.products).toHaveLength(2);
    });

    expect(mockFetchProductsPage).toHaveBeenCalledTimes(1);
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

    mockFetchProductsPage.mockResolvedValueOnce({
      products: [createProduct('prod-b2')],
      nextOffset: null,
      total: 5,
    });
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

    resolveHanging?.();
    await waitFor(() =>
      expect(
        result.current.products.some((product) => product.id === 'prod-b2')
      ).toBe(true)
    );
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
