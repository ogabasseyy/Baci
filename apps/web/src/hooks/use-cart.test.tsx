import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CartProvider, useCart } from './use-cart';

type AddToCartProduct = Parameters<ReturnType<typeof useCart>['addToCart']>[0];

// Mock logger to avoid console clutter
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: vi.fn((url: RequestInfo | URL, options?: RequestInit) =>
    globalThis.fetch(url, options)
  ),
}));

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

// Mock fetch
global.fetch = vi.fn();

describe('useCart - Validation', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  const mockProduct = {
    id: 'prod-1',
    merchant_id: 'merch-1',
    name: 'Test Product',
    description: '',
    status: 'active' as const,
    price: 100,
    manage_stock: true,
    stock: 10,
    image: '',
    imageLarge: '',
    imageHint: '',
    brand: 'Test Brand',
    gtin: '',
    mpn: '',
    slug: 'test-product',
    images: [],
    category_id: 'cat-1',
    sku: 'SKU-1',
  };

  it('removes ghost products and updates prices', async () => {
    // Setup initial cart with 2 products
    const initialCart = [
      { ...mockProduct, id: 'ghost-product', cartItemId: 'ghost-product' },
      {
        ...mockProduct,
        id: 'price-change-product',
        price: 100,
        cartItemId: 'price-change-product',
      },
      { ...mockProduct, id: 'valid-product', cartItemId: 'valid-product' },
    ];

    localStorageMock.setItem('baci-cart-guest', JSON.stringify(initialCart));

    // Mock validation response
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        invalidProductIds: ['ghost-product'],
        priceChanges: [
          { id: 'price-change-product', oldPrice: 100, newPrice: 150 },
        ],
      }),
    });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <CartProvider>{children}</CartProvider>
    );

    const { result } = renderHook(() => useCart(), { wrapper });

    // Wait for hydration
    await waitFor(() => expect(result.current.isHydrated).toBe(true));

    // Initial state check (before validation effect kicks in)
    // Note: The validation has a 500ms delay + async fetch

    // Wait for validation to complete
    await waitFor(
      () => {
        // Ghost product should be gone
        const ghost = result.current.cart.find((i) => i.id === 'ghost-product');
        expect(ghost).toBeUndefined();

        // Price should be updated
        const updated = result.current.cart.find(
          (i) => i.id === 'price-change-product'
        );
        expect(updated?.price).toBe(150);

        // Valid product should remain
        const valid = result.current.cart.find((i) => i.id === 'valid-product');
        expect(valid).toBeDefined();
      },
      { timeout: 2000 }
    );
  });

  it('handles empty or missing validation data safely', async () => {
    // Setup initial cart
    const initialCart = [
      { ...mockProduct, id: 'valid-product', cartItemId: 'valid-product' },
    ];

    localStorageMock.setItem('baci-cart-guest', JSON.stringify(initialCart));

    // Mock empty response
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}), // Empty object, fields missing
    });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <CartProvider>{children}</CartProvider>
    );

    const { result } = renderHook(() => useCart(), { wrapper });

    await waitFor(() => expect(result.current.isHydrated).toBe(true));

    // Should not crash and cart should remain
    await waitFor(
      () => {
        expect(result.current.cart).toHaveLength(1);
      },
      { timeout: 2000 }
    );
  });

  it('auto-selects the cheapest available variant for quick add flows', async () => {
    const variantProduct: AddToCartProduct = {
      ...mockProduct,
      id: 'variant-product',
      has_variants: true,
      manage_stock: true,
      variants: [
        {
          id: 'variant-256',
          product_id: 'variant-product',
          merchant_id: 'merch-1',
          price_override: 150,
          stock_quantity: 2,
          attributes: { storage: '256GB' },
        },
        {
          id: 'variant-128',
          product_id: 'variant-product',
          merchant_id: 'merch-1',
          price_override: 100,
          stock_quantity: 5,
          attributes: { storage: '128GB' },
        },
      ],
    };

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <CartProvider>{children}</CartProvider>
    );

    const { result } = renderHook(() => useCart(), { wrapper });

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        invalidProductIds: [],
        priceChanges: [],
      }),
    });

    await waitFor(() => expect(result.current.isHydrated).toBe(true));

    act(() => {
      result.current.addToCart(variantProduct, 1);
    });

    await waitFor(() => {
      expect(result.current.cart).toHaveLength(1);
      expect(result.current.cart[0]).toMatchObject({
        id: 'variant-product',
        variantId: 'variant-128',
        selectedStorage: '128GB',
        price: 100,
      });
    });
  });

  it('normalizes legacy variant fields from localStorage', async () => {
    const initialCart = [
      {
        ...mockProduct,
        id: 'variant-product',
        price: '100',
        quantity: '2',
        variant_id: 'variant-128',
        variantColor: 'Black',
        variantStorage: '128GB',
      },
    ];

    localStorageMock.setItem('baci-cart-guest', JSON.stringify(initialCart));

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <CartProvider>{children}</CartProvider>
    );

    const { result } = renderHook(() => useCart(), { wrapper });

    await waitFor(() => expect(result.current.isHydrated).toBe(true));

    expect(result.current.cart[0]).toMatchObject({
      cartItemId:
        'variant-product::variant=variant-128::color=Black::storage=128GB',
      id: 'variant-product',
      price: 100,
      quantity: 2,
      selectedColor: 'Black',
      selectedStorage: '128GB',
      variantId: 'variant-128',
    });
  });

  it('preserves explicit zero values when normalizing stored numeric fields', async () => {
    const initialCart = [
      {
        ...mockProduct,
        id: 'free-sample',
        price: '0',
        quantity: '0',
      },
      {
        ...mockProduct,
        id: 'invalid-numbers',
        price: 'not-a-price',
        quantity: 'not-a-quantity',
      },
    ];

    localStorageMock.setItem('baci-cart-guest', JSON.stringify(initialCart));

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <CartProvider>{children}</CartProvider>
    );

    const { result } = renderHook(() => useCart(), { wrapper });

    await waitFor(() => expect(result.current.isHydrated).toBe(true));

    expect(
      result.current.cart.map((item) => ({
        id: item.id,
        price: item.price,
        quantity: item.quantity,
      }))
    ).toEqual([
      { id: 'free-sample', price: 0, quantity: 0 },
      { id: 'invalid-numbers', price: 0, quantity: 1 },
    ]);
  });

  it('backfills unique cart item ids for legacy lines with different options', async () => {
    const initialCart = [
      {
        ...mockProduct,
        id: 'variant-product',
        quantity: 1,
        variant_id: 'variant-128',
        variantColor: 'Black',
        variantStorage: '128GB',
      },
      {
        ...mockProduct,
        id: 'variant-product',
        quantity: 1,
        variant_id: 'variant-128',
        variantColor: 'Blue',
        variantStorage: '128GB',
      },
    ];

    localStorageMock.setItem('baci-cart-guest', JSON.stringify(initialCart));

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <CartProvider>{children}</CartProvider>
    );

    const { result } = renderHook(() => useCart(), { wrapper });

    await waitFor(() => expect(result.current.isHydrated).toBe(true));

    expect(result.current.cart.map((item) => item.cartItemId)).toEqual([
      'variant-product::variant=variant-128::color=Black::storage=128GB',
      'variant-product::variant=variant-128::color=Blue::storage=128GB',
    ]);
  });

  it('uses variantAttributes when legacy cart lines do not have selected option fields', async () => {
    const initialCart = [
      {
        ...mockProduct,
        id: 'variant-product',
        quantity: 1,
        variant_id: 'variant-128',
        variantAttributes: {
          color: 'Black',
          storage: '128GB',
        },
      },
      {
        ...mockProduct,
        id: 'variant-product',
        quantity: 1,
        variant_id: 'variant-128',
        variantAttributes: {
          color: 'Blue',
          storage: '128GB',
        },
      },
    ];

    localStorageMock.setItem('baci-cart-guest', JSON.stringify(initialCart));

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <CartProvider>{children}</CartProvider>
    );

    const { result } = renderHook(() => useCart(), { wrapper });

    await waitFor(() => expect(result.current.isHydrated).toBe(true));

    expect(
      result.current.cart.map((item) => ({
        cartItemId: item.cartItemId,
        selectedColor: item.selectedColor,
        selectedStorage: item.selectedStorage,
      }))
    ).toEqual([
      {
        cartItemId:
          'variant-product::variant=variant-128::color=Black::storage=128GB',
        selectedColor: 'Black',
        selectedStorage: '128GB',
      },
      {
        cartItemId:
          'variant-product::variant=variant-128::color=Blue::storage=128GB',
        selectedColor: 'Blue',
        selectedStorage: '128GB',
      },
    ]);
  });

  it('matches addToCart ids when legacy nested attributes include extra axes', async () => {
    const initialCart = [
      {
        ...mockProduct,
        id: 'iphone-15',
        quantity: 1,
        condition: 'open_box',
        variant_id: 'iphone15-openbox-128-black-esim',
        variantAttributes: {
          color: 'Black',
          ram: '8GB',
          sim_type: 'eSIM Only',
          storage: '128GB',
        },
      },
    ];

    localStorageMock.setItem('baci-cart-guest', JSON.stringify(initialCart));

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <CartProvider>{children}</CartProvider>
    );

    const { result } = renderHook(() => useCart(), { wrapper });

    await waitFor(() => expect(result.current.isHydrated).toBe(true));

    expect(result.current.cart[0]).toMatchObject({
      cartItemId:
        'iphone-15::variant=iphone15-openbox-128-black-esim::color=Black::condition=open_box::storage=128GB',
      selectedColor: 'Black',
      selectedStorage: '128GB',
      variantAttributes: {
        color: 'Black',
        ram: '8GB',
        sim_type: 'eSIM Only',
        storage: '128GB',
      },
    });
  });

  it('stores the default SKU-matrix variant condition for quick add flows', async () => {
    const skuMatrixProduct: AddToCartProduct = {
      ...mockProduct,
      id: 'iphone-15',
      has_variants: true,
      manage_stock: true,
      price: 900000,
      variants: [
        {
          id: 'iphone15-openbox-128-black-esim',
          product_id: 'iphone-15',
          merchant_id: 'merch-1',
          condition: 'open_box',
          price_override: 829000,
          stock_quantity: 3,
          attributes: {
            color: 'Black',
            sim_type: 'eSIM Only',
            storage: '128GB',
          },
        },
      ],
    };

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <CartProvider>{children}</CartProvider>
    );

    const { result } = renderHook(() => useCart(), { wrapper });

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        invalidProductIds: [],
        priceChanges: [],
      }),
    });

    await waitFor(() => expect(result.current.isHydrated).toBe(true));

    act(() => {
      result.current.addToCart(skuMatrixProduct, 1);
    });

    await waitFor(() => {
      expect(result.current.cart[0]).toMatchObject({
        id: 'iphone-15',
        condition: 'open_box',
        price: 829000,
        selectedColor: 'Black',
        selectedStorage: '128GB',
        variantAttributes: {
          color: 'Black',
          sim_type: 'eSIM Only',
          storage: '128GB',
        },
        variantId: 'iphone15-openbox-128-black-esim',
      });
    });
  });

  it('defers cart validation until interaction when requested', async () => {
    vi.useFakeTimers();

    const initialCart = [
      { ...mockProduct, id: 'valid-product', cartItemId: 'valid-product' },
    ];

    localStorageMock.setItem('baci-cart-guest', JSON.stringify(initialCart));

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        invalidProductIds: [],
        priceChanges: [],
      }),
    });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <CartProvider deferValidationUntilIdle>{children}</CartProvider>
    );

    const { result } = renderHook(() => useCart(), { wrapper });

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.isHydrated).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();

    await act(async () => {
      window.dispatchEvent(new Event('pointerdown'));
      await Promise.resolve();
    });

    await act(async () => {
      vi.runOnlyPendingTimers();
      await Promise.resolve();
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });
});
