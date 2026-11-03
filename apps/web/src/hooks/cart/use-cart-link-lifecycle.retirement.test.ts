import type { CartLine, CartSnapshot } from '@baci/shared/cart';

import { act, renderHook, waitFor } from '@testing-library/react';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Product } from '@/lib/products';

import type { CartItem } from './cart-types';

import {
  bootstrapSharedCart,
  fetchSharedCartProducts,
  fetchSharedCartSnapshot,
} from './shared-cart-client';

import { useSharedCart } from './use-shared-cart';

vi.mock('./shared-cart-client', () => ({
  bootstrapSharedCart: vi.fn(),
  createSharedCart: vi.fn(),
  fetchSharedCartProducts: vi.fn(),
  fetchSharedCartSnapshot: vi.fn(),
  sendSharedCartCommand: vi.fn(),
}));

const MERCHANT_ID = '11111111-1111-4111-8111-111111111111';

const SLUG = 'ogabassey';

const CART_ID = '22222222-2222-4222-8222-222222222222';

function product(overrides: Record<string, unknown> = {}): Product {
  return {
    brand: 'Brand',
    description: '',
    gtin: '',
    id: 'prod-1',
    image: '/prod-1.png',
    imageHint: 'product',
    imageLarge: '/prod-1-large.png',
    manage_stock: false,
    mpn: '',
    name: 'Phone',
    price: 100,
    slug: 'phone',
    status: 'active',
    stock: 10,
    ...overrides,
  } as Product;
}

function _cartItem(overrides: Record<string, unknown> = {}): CartItem {
  return {
    ...product(),
    cartItemId: 'prod-1',
    quantity: 1,
    ...overrides,
  } as CartItem;
}

function cartLine(overrides: Record<string, unknown> = {}): CartLine {
  return {
    id: 'line-1',
    item: { productId: 'prod-1' },
    lineTotalMinor: 10000,
    quantity: 1,
    unitPriceMinor: 10000,
    ...overrides,
  } as CartLine;
}

function snapshot(overrides: Record<string, unknown> = {}): CartSnapshot {
  const lines = (overrides.lines as CartLine[] | undefined) ?? [cartLine()];
  const subtotalMinor = lines.reduce(
    (sum, line) => sum + line.lineTotalMinor,
    0
  );
  return {
    cartId: CART_ID,
    currency: 'NGN',
    estimatedTotals: false,
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    lines,
    merchantId: MERCHANT_ID,
    state: 'active',
    subtotalMinor,
    totalMinor: subtotalMinor,
    version: 3,
    ...overrides,
  } as CartSnapshot;
}

function mockAdopted(version = 3, lines: CartLine[] = [cartLine()]) {
  vi.mocked(fetchSharedCartSnapshot).mockResolvedValue({
    ok: true,
    snapshot: snapshot({ lines, version }),
    warnings: [],
  });
}

describe('useSharedCart link', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    vi.mocked(fetchSharedCartProducts).mockResolvedValue(new Map());
  });

  it('retries a failed adopt instead of orphaning the session with a blind bootstrap', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(fetchSharedCartSnapshot)
        .mockResolvedValueOnce({
          code: 'temporarily_unavailable',
          ok: false,
          retryable: true,
          snapshot: null,
        })
        .mockResolvedValueOnce({
          ok: true,
          snapshot: snapshot({ version: 3 }),
          warnings: [],
        });

      const { result } = renderHook(() =>
        useSharedCart({
          merchantId: MERCHANT_ID,
          merchantSlug: SLUG,
          sessionGeneration: 1,
        })
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(fetchSharedCartSnapshot).toHaveBeenCalledTimes(1);
      expect(result.current.cartId).toBeNull();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      // The advance flushes the retry timer and the adopt chain, so the
      // adoption is assertable synchronously (no waitFor under fake timers).
      expect(fetchSharedCartSnapshot).toHaveBeenCalledTimes(2);
      expect(result.current.cartId).toBe(CART_ID);
      expect(bootstrapSharedCart).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stays inert when disabled', async () => {
    const { result } = renderHook(() =>
      useSharedCart({
        enabled: false,
        merchantId: MERCHANT_ID,
        merchantSlug: SLUG,
        sessionGeneration: 1,
      })
    );

    expect(result.current.cart).toEqual([]);
    expect(result.current.isHydrated).toBe(true);
    await act(async () => {
      result.current.addToCart(product(), 1);
    });
    expect(fetchSharedCartSnapshot).not.toHaveBeenCalled();
    expect(result.current.cart).toEqual([]);
  });

  it("never persists one merchant's lines under another merchant's key", async () => {
    vi.mocked(fetchSharedCartSnapshot)
      .mockResolvedValueOnce({
        ok: true,
        snapshot: snapshot({
          lines: [cartLine({ id: 'line-a', item: { productId: 'prod-a' } })],
          version: 3,
        }),
        warnings: [],
      })
      .mockResolvedValue({
        ok: true,
        snapshot: snapshot({
          lines: [cartLine({ id: 'line-b', item: { productId: 'prod-b' } })],
          version: 7,
        }),
        warnings: [],
      });
    const { rerender } = renderHook(
      ({ generation, slug }) =>
        useSharedCart({
          merchantId: MERCHANT_ID,
          merchantSlug: slug,
          sessionGeneration: generation,
        }),
      { initialProps: { generation: 1, slug: 'first' } }
    );
    await waitFor(() =>
      expect(fetchSharedCartSnapshot).toHaveBeenCalledTimes(1)
    );
    await waitFor(() =>
      expect(
        window.localStorage.getItem('baci-cart-first-guest')
      ).not.toBeNull()
    );

    // The provider switches slug and generation in one commit. The
    // transition commit still holds merchant A's reducer state while
    // carrying merchant B's slug; persisting there would file A's lines
    // under B's key, poisoning B's next cache seed and legacy import.
    rerender({ generation: 2, slug: 'second' });
    expect(window.localStorage.getItem('baci-cart-second-guest')).toBeNull();

    await waitFor(() =>
      expect(fetchSharedCartSnapshot).toHaveBeenCalledTimes(2)
    );
  });

  it('retires surviving device cart authority when shared_cart is disabled after enrollment', async () => {
    mockAdopted();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json({ revoked: true }));
    const { rerender } = renderHook(
      ({ enabled }) =>
        useSharedCart({
          enabled,
          merchantId: MERCHANT_ID,
          merchantSlug: SLUG,
          sessionGeneration: 1,
        }),
      { initialProps: { enabled: true } }
    );

    await waitFor(() =>
      expect(fetchSharedCartSnapshot).toHaveBeenCalledTimes(1)
    );

    await act(async () => {
      rerender({ enabled: false });
    });

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/storefront/cart/session/revoke?merchantSlug=ogabassey',
        expect.objectContaining({ method: 'POST' })
      )
    );
    fetchSpy.mockRestore();
  });
});
