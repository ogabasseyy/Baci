import { jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react-native';
import type React from 'react';
import { resolveAndEvictProduct } from '@/hooks/product-utils';
import { useMerchant } from '@/hooks/use-merchant';
import type { Product } from '@/types/product';
import { useProductSearch } from './use-product-search';
import { useProducts } from './use-products';

jest.mock('@/hooks/use-merchant', () => ({
  useMerchant: jest.fn(),
}));

jest.mock('./use-products', () => ({
  useProducts: jest.fn(),
}));

jest.mock('@/hooks/product-utils', () => ({
  ...(jest.requireActual('@/hooks/product-utils') as object),
  resolveAndEvictProduct: jest.fn(),
}));

jest.mock('./use-product', () => ({
  ...(jest.requireActual('./use-product') as object),
  augmentProduct: jest.fn((row: unknown) => ({
    ...(row as Record<string, unknown>),
    augmented: true,
  })),
}));

jest.mock('@/lib/validation', () => ({
  ...(jest.requireActual('@/lib/validation') as object),
  ProductRowSchema: {
    safeParse: jest.fn(() => ({ success: true, data: { id: 'row-1' } })),
  },
}));

const mockUseMerchant = useMerchant as unknown as jest.MockedFunction<
  typeof useMerchant
>;
const mockUseProducts = useProducts as unknown as jest.MockedFunction<
  typeof useProducts
>;
const mockResolveAndEvictProduct =
  resolveAndEvictProduct as unknown as jest.MockedFunction<
    typeof resolveAndEvictProduct
  >;

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      {children}
    </QueryClientProvider>
  );
}

describe('useProductSearch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseMerchant.mockReturnValue({
      data: { id: 'merchant-1' },
    } as never);
    mockUseProducts.mockReturnValue({
      products: [{ id: 'product-1' }],
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    } as never);
  });

  it('passes search options through and returns list state', () => {
    const { result } = renderHook(
      () => useProductSearch({ enabled: true, limit: 8, search: 'iphone' }),
      { wrapper }
    );

    expect(mockUseProducts).toHaveBeenCalledWith({
      enabled: true,
      limit: 8,
      search: 'iphone',
    });
    expect(result.current.products).toEqual([{ id: 'product-1' }]);
    expect(result.current.isLoading).toBe(false);
    expect(typeof result.current.resolveProduct).toBe('function');
  });

  it('resolves a preview product through the validated fetch', async () => {
    mockResolveAndEvictProduct.mockResolvedValue({
      id: 'product-1',
      slug: 'iphone-15',
    });
    const { result } = renderHook(() => useProductSearch({}), { wrapper });

    const resolved = await result.current.resolveProduct({
      id: 'product-1',
      slug: 'iphone-15',
    } as Product);

    expect(mockResolveAndEvictProduct).toHaveBeenCalledWith(
      'merchant-1',
      'iphone-15',
      expect.anything()
    );
    expect(resolved).toMatchObject({ id: 'row-1', augmented: true });
  });

  it('rejects resolveProduct without a network call when the slug is missing', async () => {
    const { result } = renderHook(() => useProductSearch({}), { wrapper });

    await expect(
      result.current.resolveProduct({ id: 'product-1' } as Product)
    ).rejects.toThrow('Product has no slug to resolve');
    expect(mockResolveAndEvictProduct).not.toHaveBeenCalled();
  });
});
