import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCart } from './cart-context';
import { StorefrontCartProvider } from './storefront-cart-provider';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
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
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock });
global.fetch = vi.fn();

const product = {
  id: 'prod-1',
  merchant_id: 'merchant-1',
  name: 'Phone',
  description: '',
  status: 'active' as const,
  price: 100,
  manage_stock: false,
  stock: 10,
  image: '',
  imageLarge: '',
  imageHint: '',
  brand: 'Brand',
  gtin: '',
  mpn: '',
  slug: 'phone',
  images: [],
};

describe('StorefrontCartProvider merchant switching', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it('loads the resolved merchant cart before a Santa product is added', async () => {
    localStorageMock.setItem(
      'baci-cart-first-guest',
      JSON.stringify([{ ...product, id: 'first', quantity: 1 }])
    );
    localStorageMock.setItem(
      'baci-cart-second-guest',
      JSON.stringify([{ ...product, id: 'second', quantity: 1 }])
    );

    const wrapper = ({ children }: { children: ReactNode }) => (
      <StorefrontCartProvider merchantSlug="first">
        {children}
      </StorefrontCartProvider>
    );
    const { result } = renderHook(() => useCart(), { wrapper });
    await waitFor(() => expect(result.current.isHydrated).toBe(true));

    act(() => result.current.setMerchantSlug('second'));
    await waitFor(() => expect(result.current.merchantSlug).toBe('second'));

    act(() => result.current.addToCart(product, 1));

    expect(result.current.cart.map((item) => item.id)).toEqual([
      'second',
      'prod-1',
    ]);
  });

  it('preserves current cart state when the active merchant is set again', async () => {
    const firstProduct = { ...product, id: 'first-added' };
    const secondProduct = { ...product, id: 'second-added' };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StorefrontCartProvider merchantSlug="first">
        {children}
      </StorefrontCartProvider>
    );
    const { result } = renderHook(() => useCart(), { wrapper });
    await waitFor(() => expect(result.current.isHydrated).toBe(true));

    act(() => {
      result.current.setMerchantSlug('second');
      result.current.addToCart(firstProduct, 1);
      result.current.setMerchantSlug('second');
      result.current.addToCart(secondProduct, 1);
    });

    expect(result.current.cart.map((item) => item.id)).toEqual([
      'first-added',
      'second-added',
    ]);
  });

  it('clears the loaded merchant group deal before an immediate cart add', async () => {
    localStorageMock.setItem(
      'baci-cart-second-guest',
      JSON.stringify([
        {
          ...product,
          id: 'negotiated',
          negotiatedPrice: 80,
          negotiationStatus: 'accepted',
          quantity: 1,
        },
      ])
    );
    localStorageMock.setItem('baci-cart-second-group-negotiation', 'true');

    const wrapper = ({ children }: { children: ReactNode }) => (
      <StorefrontCartProvider merchantSlug="first">
        {children}
      </StorefrontCartProvider>
    );
    const { result } = renderHook(() => useCart(), { wrapper });
    await waitFor(() => expect(result.current.isHydrated).toBe(true));

    act(() => {
      result.current.setMerchantSlug('second');
      result.current.addToCart(product, 1);
    });

    expect(result.current.cartWideNegotiationActive).toBe(false);
    expect(
      result.current.cart.every(
        (item) =>
          item.negotiatedPrice === undefined &&
          item.negotiationStatus === undefined
      )
    ).toBe(true);
  });
});
