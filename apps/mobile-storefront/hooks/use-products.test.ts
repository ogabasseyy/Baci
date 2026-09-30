import { jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
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
});
