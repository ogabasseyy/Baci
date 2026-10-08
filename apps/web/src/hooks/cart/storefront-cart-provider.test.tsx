import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCart } from './cart-context';
import { StorefrontCartProvider } from './storefront-cart-provider';

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

global.fetch = vi.fn();

function buildVoucherToken(expiresAt: string): string {
  const body = Buffer.from(JSON.stringify({ expiresAt }), 'utf8').toString(
    'base64url'
  );
  return `qv1.${body}.fake-signature`;
}

describe('StorefrontCartProvider', () => {
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

  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('hydrates from the existing merchant cart storage key and supports addToCart', async () => {
    localStorageMock.setItem(
      'baci-cart-ogabassey-guest',
      JSON.stringify([{ ...mockProduct, quantity: 1, cartItemId: 'prod-1' }])
    );

    const wrapper = ({ children }: { children: ReactNode }) => (
      <StorefrontCartProvider merchantSlug="ogabassey">
        {children}
      </StorefrontCartProvider>
    );

    const { result } = renderHook(() => useCart(), { wrapper });

    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    expect(result.current.totalItems).toBe(1);

    act(() => {
      result.current.addToCart(mockProduct, 1);
    });

    expect(result.current.totalItems).toBe(2);
    expect(result.current.cart[0]?.id).toBe('prod-1');
  });

  it('lets a quiz prize voucher line bypass the out-of-stock guard (unit was reserved at mint)', async () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StorefrontCartProvider merchantSlug="ogabassey">
        {children}
      </StorefrontCartProvider>
    );
    const { result } = renderHook(() => useCart(), { wrapper });
    await waitFor(() => expect(result.current.isHydrated).toBe(true));

    // The last serialized unit is reserved for the winner → public stock is 0.
    const soldOut = { ...mockProduct, manage_stock: true, stock: 0 };

    // A normal add is still blocked when out of stock.
    act(() => {
      result.current.addToCart(soldOut, 1);
    });
    expect(result.current.totalItems).toBe(0);

    // The winner's own prize voucher line bypasses the guard and is added.
    act(() => {
      result.current.addToCart(soldOut, 1, {
        quizAwardId: 'award-1',
        quizVoucherToken: 'qv1.aaa.bbb',
      });
    });
    expect(result.current.totalItems).toBe(1);
    expect(result.current.cart[0]?.quizAwardId).toBe('award-1');
  });

  it('prunes expired voucher lines during mount hydration and persists the result', async () => {
    localStorageMock.setItem(
      'baci-cart-ogabassey-guest',
      JSON.stringify([
        { ...mockProduct, id: 'plain', quantity: 1, cartItemId: 'plain' },
        {
          ...mockProduct,
          id: 'expired',
          quantity: 1,
          cartItemId: 'expired',
          quizAwardId: 'award-expired',
          quizVoucherToken: buildVoucherToken('2000-01-01T00:00:00.000Z'),
        },
        {
          ...mockProduct,
          id: 'live',
          quantity: 1,
          cartItemId: 'live',
          quizAwardId: 'award-live',
          quizVoucherToken: buildVoucherToken('2099-01-01T00:00:00.000Z'),
        },
      ])
    );

    const wrapper = ({ children }: { children: ReactNode }) => (
      <StorefrontCartProvider merchantSlug="ogabassey">
        {children}
      </StorefrontCartProvider>
    );
    const { result } = renderHook(() => useCart(), { wrapper });

    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    expect(result.current.cart.map((item) => item.id)).toEqual([
      'plain',
      'live',
    ]);
    await waitFor(() => {
      const persisted = JSON.parse(
        localStorageMock.getItem('baci-cart-ogabassey-guest') ?? '[]'
      ) as Array<{ id: string }>;
      expect(persisted.map((item) => item.id)).toEqual(['plain', 'live']);
    });
  });

  it('prunes and persists expired vouchers when the merchant slug changes', async () => {
    localStorageMock.setItem(
      'baci-cart-first-guest',
      JSON.stringify([{ ...mockProduct, quantity: 1, cartItemId: 'first' }])
    );
    localStorageMock.setItem(
      'baci-cart-second-guest',
      JSON.stringify([
        {
          ...mockProduct,
          id: 'expired',
          quantity: 1,
          cartItemId: 'expired',
          quizAwardId: 'award-expired',
          quizVoucherToken: buildVoucherToken('2000-01-01T00:00:00.000Z'),
        },
        {
          ...mockProduct,
          id: 'live',
          quantity: 1,
          cartItemId: 'live',
          quizAwardId: 'award-live',
          quizVoucherToken: buildVoucherToken('2099-01-01T00:00:00.000Z'),
        },
      ])
    );

    let merchantSlug = 'first';
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StorefrontCartProvider merchantSlug={merchantSlug}>
        {children}
      </StorefrontCartProvider>
    );
    const { result, rerender } = renderHook(() => useCart(), { wrapper });
    await waitFor(() => expect(result.current.isHydrated).toBe(true));

    merchantSlug = 'second';
    rerender();

    await waitFor(() => expect(result.current.merchantSlug).toBe('second'));
    expect(result.current.cart.map((item) => item.id)).toEqual(['live']);
    await waitFor(() => {
      const persisted = JSON.parse(
        localStorageMock.getItem('baci-cart-second-guest') ?? '[]'
      ) as Array<{ id: string }>;
      expect(persisted.map((item) => item.id)).toEqual(['live']);
    });
  });

  it('resets a cart-wide negotiation when a line is removed', async () => {
    const product2 = {
      ...mockProduct,
      id: 'prod-2',
      slug: 'prod-2',
      sku: 'SKU-2',
      price: 200,
    };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StorefrontCartProvider merchantSlug="ogabassey" enableSmartCartPro>
        {children}
      </StorefrontCartProvider>
    );

    const { result } = renderHook(() => useCart(), { wrapper });
    await waitFor(() => expect(result.current.isHydrated).toBe(true));

    act(() => {
      result.current.addToCart(mockProduct, 1);
      result.current.addToCart(product2, 1);
    });
    expect(result.current.cart).toHaveLength(2);

    act(() => {
      result.current.applyCartWideNegotiation?.(270);
    });
    expect(result.current.cartWideNegotiationActive).toBe(true);
    expect(
      result.current.cart.every((item) => item.negotiationStatus === 'accepted')
    ).toBe(true);

    const removeId = result.current.cart[0]?.cartItemId;
    expect(removeId).toBeDefined();
    act(() => {
      result.current.removeFromCart(removeId as string);
    });

    expect(result.current.cart).toHaveLength(1);
    expect(result.current.cartWideNegotiationActive).toBe(false);
    expect(result.current.cart[0]?.negotiatedPrice).toBeUndefined();
    expect(result.current.cart[0]?.negotiationStatus).toBeUndefined();
  });

  it('clears persisted cart and group-negotiation state against the active merchant key', async () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StorefrontCartProvider merchantSlug="ogabassey" enableSmartCartPro>
        {children}
      </StorefrontCartProvider>
    );

    const { result } = renderHook(() => useCart(), { wrapper });
    await waitFor(() => expect(result.current.isHydrated).toBe(true));

    act(() => {
      result.current.addToCart(mockProduct, 1);
    });
    act(() => {
      result.current.applyCartWideNegotiation?.(90);
    });
    await waitFor(() =>
      expect(
        localStorageMock.getItem('baci-cart-ogabassey-group-negotiation')
      ).toBe('true')
    );

    act(() => {
      result.current.clearCart();
    });

    // The merchant-scoped keys must be cleared (not left to rehydrate after a
    // refresh on the same storefront). The group flag is removed when inactive.
    expect(localStorageMock.getItem('baci-cart-ogabassey-guest')).toBe('[]');
    expect(
      localStorageMock.getItem('baci-cart-ogabassey-group-negotiation')
    ).toBeNull();
  });

  it('resets a cart-wide negotiation on a positive quantity change', async () => {
    const product2 = {
      ...mockProduct,
      id: 'prod-2',
      slug: 'prod-2',
      sku: 'SKU-2',
      price: 200,
    };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StorefrontCartProvider merchantSlug="ogabassey" enableSmartCartPro>
        {children}
      </StorefrontCartProvider>
    );

    const { result } = renderHook(() => useCart(), { wrapper });
    await waitFor(() => expect(result.current.isHydrated).toBe(true));

    act(() => {
      result.current.addToCart(mockProduct, 1);
      result.current.addToCart(product2, 1);
    });
    act(() => {
      result.current.applyCartWideNegotiation?.(270);
    });
    expect(result.current.cartWideNegotiationActive).toBe(true);

    // A positive quantity change (not removal) must also reset the group deal.
    const targetId = result.current.cart[0]?.cartItemId;
    act(() => {
      result.current.updateQuantity(targetId as string, 3);
    });

    expect(result.current.cartWideNegotiationActive).toBe(false);
    expect(
      result.current.cart.every((item) => item.negotiatedPrice === undefined)
    ).toBe(true);
    expect(
      result.current.cart.find((item) => item.cartItemId === targetId)?.quantity
    ).toBe(3);
  });

  it('defers validation until interaction when requested', async () => {
    vi.useFakeTimers();

    localStorageMock.setItem(
      'baci-cart-ogabassey-guest',
      JSON.stringify([{ ...mockProduct, quantity: 1, cartItemId: 'prod-1' }])
    );

    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        invalidProductIds: [],
        priceChanges: [],
      }),
    } as Response);

    const wrapper = ({ children }: { children: ReactNode }) => (
      <StorefrontCartProvider
        merchantSlug="ogabassey"
        deferValidationUntilIdle
        validationActivationTimeoutMs={5_000}
      >
        {children}
      </StorefrontCartProvider>
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
  });

  it('does not validate/persist the cart while the document is prerendering, then does on activation', async () => {
    vi.useFakeTimers();

    Object.defineProperty(document, 'prerendering', {
      configurable: true,
      value: true,
    });

    localStorageMock.setItem(
      'baci-cart-ogabassey-guest',
      JSON.stringify([{ ...mockProduct, quantity: 1, cartItemId: 'prod-1' }])
    );

    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        invalidProductIds: [],
        priceChanges: [],
      }),
    } as Response);

    const wrapper = ({ children }: { children: ReactNode }) => (
      <StorefrontCartProvider
        merchantSlug="ogabassey"
        deferValidationUntilIdle
        validationActivationTimeoutMs={5_000}
      >
        {children}
      </StorefrontCartProvider>
    );

    const { result } = renderHook(() => useCart(), { wrapper });

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.isHydrated).toBe(true);

    // Idle/timeout activation fires inside the (hidden) prerender: validation
    // must NOT run, or a discarded prerender would mutate the real cart.
    await act(async () => {
      vi.runOnlyPendingTimers();
      await Promise.resolve();
    });
    expect(global.fetch).not.toHaveBeenCalled();

    // The page is presented to the user: prerendering clears and validation now
    // runs exactly once.
    Object.defineProperty(document, 'prerendering', {
      configurable: true,
      value: false,
    });
    await act(async () => {
      document.dispatchEvent(new Event('prerenderingchange'));
      await Promise.resolve();
    });
    await act(async () => {
      vi.runOnlyPendingTimers();
      await Promise.resolve();
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);

    Reflect.deleteProperty(document, 'prerendering');
  });

  it('stores the default SKU-matrix variant identity, attributes, and condition for quick add flows', async () => {
    const skuMatrixProduct = {
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
          condition: 'open_box' as const,
          attributes: {
            color: 'Black',
            sim_type: 'eSIM Only',
            storage: '128GB',
          },
          price_override: 829000,
          stock_quantity: 3,
        },
      ],
    };

    const wrapper = ({ children }: { children: ReactNode }) => (
      <StorefrontCartProvider merchantSlug="ogabassey">
        {children}
      </StorefrontCartProvider>
    );

    const { result } = renderHook(() => useCart(), { wrapper });

    await waitFor(() => expect(result.current.isHydrated).toBe(true));

    act(() => {
      result.current.addToCart(skuMatrixProduct, 1);
    });

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
