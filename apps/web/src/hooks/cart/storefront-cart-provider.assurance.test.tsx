import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('StorefrontCartProvider', () => {
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

  it.each([
    'ogabassey',
    'another-store',
  ])('defaults assurance only for Ogabassey and preserves opt-out: %s', async (merchantSlug) => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StorefrontCartProvider merchantSlug={merchantSlug} enableSmartCartPro>
        {children}
      </StorefrontCartProvider>
    );
    const { result } = renderHook(() => useCart(), { wrapper });
    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    act(() => result.current.addToCart(mockProduct));
    expect(result.current.cart[0].hasAssurance).toBe(
      merchantSlug === 'ogabassey'
    );
    if (merchantSlug === 'ogabassey') {
      expect(result.current.cartTotal).toBe(105);
      act(() =>
        result.current.toggleAssurance?.(result.current.cart[0].cartItemId)
      );
      expect(result.current.cartTotal).toBe(100);
      act(() => result.current.addToCart(mockProduct));
      expect(result.current.cart[0].hasAssurance).toBe(false);
      expect(result.current.cartTotal).toBe(200);
    }
  });

  it('uses the explicitly switched merchant when adding in the same event', async () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StorefrontCartProvider enableSmartCartPro>
        {children}
      </StorefrontCartProvider>
    );
    const { result } = renderHook(() => useCart(), { wrapper });
    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    act(() => {
      result.current.setMerchantSlug('ogabassey');
      result.current.addToCart(mockProduct);
    });
    expect(result.current.cart[0].hasAssurance).toBe(true);
    expect(result.current.cartTotal).toBe(105);
  });

  it('rehydrates a saved opt-out without charging Assurance on a subsequent merge', async () => {
    localStorageMock.setItem(
      'baci-cart-ogabassey-guest',
      JSON.stringify([{ ...mockProduct, quantity: 1, hasAssurance: false }])
    );
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StorefrontCartProvider merchantSlug="ogabassey" enableSmartCartPro>
        {children}
      </StorefrontCartProvider>
    );
    const { result } = renderHook(() => useCart(), { wrapper });
    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    expect(result.current.cart[0].hasAssurance).toBe(false);
    act(() => result.current.addToCart(mockProduct));
    expect(result.current.cart[0]).toMatchObject({
      hasAssurance: false,
      quantity: 2,
    });
    expect(result.current.cartTotal).toBe(200);
  });

  it('applies the latest explicit assurance choice when lines merge', async () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StorefrontCartProvider merchantSlug="ogabassey" enableSmartCartPro>
        {children}
      </StorefrontCartProvider>
    );
    const { result } = renderHook(() => useCart(), { wrapper });
    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    act(() => result.current.addToCart(mockProduct, 1, { hasAssurance: true }));
    act(() =>
      result.current.addToCart(mockProduct, 1, { hasAssurance: false })
    );
    expect(result.current.cart[0]).toMatchObject({
      hasAssurance: false,
      quantity: 2,
    });
    act(() => result.current.addToCart(mockProduct, 1));
    expect(result.current.cart[0]).toMatchObject({
      hasAssurance: false,
      quantity: 3,
    });
  });

  it('respects an explicit assurance opt-out passed to addToCart', async () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StorefrontCartProvider merchantSlug="ogabassey" enableSmartCartPro>
        {children}
      </StorefrontCartProvider>
    );
    const { result } = renderHook(() => useCart(), { wrapper });
    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    act(() =>
      result.current.addToCart(mockProduct, 1, { hasAssurance: false })
    );
    expect(result.current.cart[0].hasAssurance).toBe(false);
    expect(result.current.cartTotal).toBe(100);
  });

  it('forces quiz voucher lines to opt out without an explicit choice', async () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StorefrontCartProvider merchantSlug="ogabassey" enableSmartCartPro>
        {children}
      </StorefrontCartProvider>
    );
    const { result } = renderHook(() => useCart(), { wrapper });
    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    act(() =>
      result.current.addToCart(mockProduct, 1, {
        quizAwardId: 'award-1',
        quizVoucherToken: 'token-1',
      })
    );
    expect(result.current.cart[0].hasAssurance).toBe(false);
    act(() =>
      result.current.addToCart({ ...mockProduct, id: 'prod-2' }, 1, {
        quizAwardId: 'award-2',
        quizVoucherToken: 'token-2',
        hasAssurance: true,
      })
    );
    expect(result.current.cart[1].hasAssurance).toBe(true);
  });
});
