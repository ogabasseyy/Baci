import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCart } from './cart-context';
import {
  fetchSharedCartProducts,
  fetchSharedCartSnapshot,
} from './shared-cart-client';
import { StorefrontCartProvider } from './storefront-cart-provider';
import {
  makeProviderCartLine as cartLine,
  createLocalStorageMock,
  PROVIDER_MERCHANT_ID as MERCHANT_A,
  PROVIDER_MERCHANT_B_ID as MERCHANT_B,
  makeProviderProduct,
  makeProviderSnapshot,
  resetCartSessionHintForTests,
  writeCartSessionHint,
} from './storefront-cart-provider.test-support';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: vi.fn((url: RequestInfo | URL, options?: RequestInit) =>
    globalThis.fetch(url, options)
  ),
}));

vi.mock('./shared-cart-client', () => ({
  bootstrapSharedCart: vi.fn(),
  createSharedCart: vi.fn(),
  fetchSharedCartProducts: vi.fn(),
  fetchSharedCartSnapshot: vi.fn(),
  sendSharedCartCommand: vi.fn(),
}));

const localStorageMock = createLocalStorageMock();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });
global.fetch = vi.fn();

const product = makeProviderProduct({
  merchant_id: 'merchant-1',
  image: '',
  imageLarge: '',
  imageHint: '',
  images: [],
});

const snapshot = (
  cartId: string,
  merchantId: string,
  lines: ReturnType<typeof cartLine>[],
  version: number
) => makeProviderSnapshot({ cartId, merchantId, lines, version });

describe('StorefrontCartProvider merchant switching', () => {
  afterEach(() => {
    resetCartSessionHintForTests();
  });

  beforeEach(() => {
    localStorageMock.clear();
    resetCartSessionHintForTests();
    writeCartSessionHint(MERCHANT_A, '1');
    writeCartSessionHint(MERCHANT_B, '1');
    vi.clearAllMocks();
    vi.mocked(fetchSharedCartProducts).mockResolvedValue(new Map());
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

  it('adopts the saved cart when the merchant slug prop changes', async () => {
    localStorageMock.setItem(
      'baci-cart-first-guest',
      JSON.stringify([{ ...product, id: 'first', quantity: 1 }])
    );
    localStorageMock.setItem(
      'baci-cart-second-guest',
      JSON.stringify([{ ...product, id: 'second', quantity: 1 }])
    );

    let slug: string | undefined = 'first';
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StorefrontCartProvider merchantSlug={slug}>
        {children}
      </StorefrontCartProvider>
    );
    const { result, rerender } = renderHook(() => useCart(), { wrapper });
    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    expect(result.current.cart.map((item) => item.id)).toEqual(['first']);

    slug = 'second';
    rerender();
    await waitFor(() => expect(result.current.merchantSlug).toBe('second'));
    expect(result.current.cart.map((item) => item.id)).toEqual(['second']);

    // The handler-facing refs sync from committed state, so re-setting the
    // adopted slug is a no-op that keeps the adopted cart for later adds.
    act(() => {
      result.current.setMerchantSlug('second');
      result.current.addToCart(product, 1);
    });
    expect(result.current.cart.map((item) => item.id)).toEqual([
      'second',
      'prod-1',
    ]);
  });

  it('re-adopts the shared cart when navigation serves another enrolled merchant', async () => {
    vi.mocked(fetchSharedCartSnapshot)
      .mockResolvedValueOnce({
        ok: true,
        snapshot: snapshot(
          'cart-a',
          MERCHANT_A,
          [cartLine({ id: 'line-a', item: { productId: 'prod-a' } })],
          3
        ),
        warnings: [],
      })
      .mockResolvedValue({
        ok: true,
        snapshot: snapshot(
          'cart-b',
          MERCHANT_B,
          [cartLine({ id: 'line-b', item: { productId: 'prod-b' } })],
          7
        ),
        warnings: [],
      });

    let served = {
      merchantId: MERCHANT_A,
      merchantSlug: 'first',
      sharedCartEnabled: true,
    };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StorefrontCartProvider
        merchantId={served.merchantId}
        merchantSlug={served.merchantSlug}
        sharedCartEnabled={served.sharedCartEnabled}
      >
        {children}
      </StorefrontCartProvider>
    );
    const { result, rerender } = renderHook(() => useCart(), { wrapper });
    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    await waitFor(() =>
      expect(result.current.cart.map((line) => line.id)).toEqual(['prod-a'])
    );

    // The frame serves merchant B with B's enrollment in one render.
    served = {
      merchantId: MERCHANT_B,
      merchantSlug: 'second',
      sharedCartEnabled: true,
    };
    rerender();
    await waitFor(() => expect(result.current.merchantSlug).toBe('second'));
    expect(result.current.sharedCartEnabled).toBe(true);
    expect(fetchSharedCartSnapshot).toHaveBeenCalledTimes(2);
    await waitFor(() =>
      expect(result.current.cart.map((line) => line.id)).toEqual(['prod-b'])
    );
  });

  it('falls back to the legacy cart when navigation serves an unenrolled merchant', async () => {
    localStorageMock.setItem(
      'baci-cart-second-guest',
      JSON.stringify([{ ...product, id: 'second', quantity: 1 }])
    );
    vi.mocked(fetchSharedCartSnapshot).mockResolvedValue({
      ok: true,
      snapshot: snapshot(
        'cart-a',
        MERCHANT_A,
        [cartLine({ id: 'line-a', item: { productId: 'prod-a' } })],
        3
      ),
      warnings: [],
    });

    let served = {
      merchantId: MERCHANT_A,
      merchantSlug: 'first',
      sharedCartEnabled: true,
    };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StorefrontCartProvider
        merchantId={served.merchantId}
        merchantSlug={served.merchantSlug}
        sharedCartEnabled={served.sharedCartEnabled}
      >
        {children}
      </StorefrontCartProvider>
    );
    const { result, rerender } = renderHook(() => useCart(), { wrapper });
    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    await waitFor(() =>
      expect(result.current.cart.map((line) => line.id)).toEqual(['prod-a'])
    );

    served = {
      merchantId: MERCHANT_B,
      merchantSlug: 'second',
      sharedCartEnabled: false,
    };
    rerender();
    await waitFor(() => expect(result.current.merchantSlug).toBe('second'));

    // Merchant A's server cart never shows under merchant B.
    expect(result.current.sharedCartEnabled).toBe(false);
    expect(result.current.cart.map((line) => line.id)).toEqual(['second']);
    // No second adopt: the unenrolled merchant stays fully local.
    expect(fetchSharedCartSnapshot).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.addToCart(product, 1);
    });
    expect(result.current.cart.map((line) => line.id)).toEqual([
      'second',
      'prod-1',
    ]);
    expect(fetchSharedCartSnapshot).toHaveBeenCalledTimes(1);
  });
});
