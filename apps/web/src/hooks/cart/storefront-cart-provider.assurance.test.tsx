import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MerchantContext } from '@/hooks/merchant/merchant-context';
import type { MerchantContextType } from '@/hooks/merchant/types';
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
    const merchantValue = {
      merchant: {
        slug: merchantSlug,
        feature_settings: { shipping_insurance_enabled: true },
      },
      loading: false,
    } as unknown as MerchantContextType;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MerchantContext.Provider value={merchantValue}>
        <StorefrontCartProvider merchantSlug={merchantSlug} enableSmartCartPro>
          {children}
        </StorefrontCartProvider>
      </MerchantContext.Provider>
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
    const merchantValue = {
      merchant: {
        slug: 'ogabassey',
        feature_settings: { shipping_insurance_enabled: true },
      },
      loading: false,
    } as unknown as MerchantContextType;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MerchantContext.Provider value={merchantValue}>
        <StorefrontCartProvider enableSmartCartPro>
          {children}
        </StorefrontCartProvider>
      </MerchantContext.Provider>
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

  it.each([
    { label: 'award id only', options: { quizAwardId: 'award-3' } },
    { label: 'token only', options: { quizVoucherToken: 'token-4' } },
  ])('opts out single-identifier voucher lines ($label) like native OR semantics', async ({
    options,
  }) => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StorefrontCartProvider merchantSlug="ogabassey" enableSmartCartPro>
        {children}
      </StorefrontCartProvider>
    );
    const { result } = renderHook(() => useCart(), { wrapper });
    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    act(() => result.current.addToCart(mockProduct, 1, options));
    expect(result.current.cart[0].hasAssurance).toBe(false);
  });

  it.each([
    {
      label: 'disabled setting',
      merchant: {
        slug: 'ogabassey',
        feature_settings: { shipping_insurance_enabled: false },
      },
      expected: false,
    },
    {
      label: 'missing setting',
      merchant: {
        slug: 'ogabassey',
        feature_settings: {},
      },
      expected: false,
    },
    {
      label: 'missing feature settings',
      merchant: {
        slug: 'ogabassey',
      },
      expected: false,
    },
    {
      label: 'mismatched context merchant',
      merchant: {
        slug: 'another-store',
        feature_settings: { shipping_insurance_enabled: true },
      },
      expected: false,
    },
    {
      label: 'enabled setting',
      merchant: {
        slug: 'ogabassey',
        feature_settings: { shipping_insurance_enabled: true },
      },
      expected: true,
    },
  ])('gates the default on the visible insurance setting ($label)', async ({
    merchant,
    expected,
  }) => {
    const merchantValue = {
      merchant,
      loading: false,
    } as unknown as MerchantContextType;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MerchantContext.Provider value={merchantValue}>
        <StorefrontCartProvider merchantSlug="ogabassey" enableSmartCartPro>
          {children}
        </StorefrontCartProvider>
      </MerchantContext.Provider>
    );
    const { result } = renderHook(() => useCart(), { wrapper });
    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    act(() => result.current.addToCart(mockProduct));
    // The line-item toggles hide when the setting is off or the
    // context merchant mismatches, so the default must stay off
    // there too: no fee without a visible removal control.
    expect(result.current.cart[0].hasAssurance).toBe(expected);
    expect(result.current.cartTotal).toBe(expected ? 105 : 100);
  });
});
