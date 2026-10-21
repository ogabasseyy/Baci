import type { CartLine, CartSnapshot } from '@baci/shared/cart';

import { act, renderHook, waitFor } from '@testing-library/react';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Product } from '@/lib/products';

import { saveCartToStorage } from './cart-storage';

import type { CartItem } from './cart-types';

import {
  bootstrapSharedCart,
  createSharedCart,
  fetchSharedCartProducts,
  fetchSharedCartSnapshot,
  sendSharedCartCommand,
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

function cartItem(overrides: Record<string, unknown> = {}): CartItem {
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

  it('shows the cached cart instantly, then adopts the server snapshot', async () => {
    saveCartToStorage(
      [cartItem({ id: 'cached-1', name: 'Cached', price: 50, quantity: 2 })],
      SLUG
    );
    mockAdopted();
    // The cached line imports, then the receipt pins the adopted cart.
    vi.mocked(sendSharedCartCommand).mockResolvedValue({
      ok: true,
      replayed: false,
      snapshot: snapshot({
        lines: [
          cartLine(),
          cartLine({
            id: 'line-cached',
            item: { productId: 'cached-1' },
            lineTotalMinor: 10000,
            quantity: 2,
            unitPriceMinor: 5000,
          }),
        ],
        version: 4,
      }),
      warnings: [],
    });

    const { result } = renderHook(() =>
      useSharedCart({
        merchantId: MERCHANT_ID,
        merchantSlug: SLUG,
        sessionGeneration: 1,
      })
    );

    // Instant: the cache is the display before any network resolves.
    expect(result.current.isHydrated).toBe(true);
    expect(result.current.cart.map((line) => line.id)).toEqual(['cached-1']);

    await waitFor(() => expect(result.current.cartId).toBe(CART_ID));
    // The cached line stays visible through the import, then the
    // confirmed snapshot (import included) takes over exactly once.
    await waitFor(() =>
      expect(result.current.cart.map((line) => line.id)).toEqual([
        'prod-1',
        'cached-1',
      ])
    );
    expect(result.current.version).toBe(4);
    expect(result.current.syncStatus).toBe('synced');
    expect(result.current.importStatus).toBe('done');
  });

  it('hydrates foreign lines the cache has never seen', async () => {
    mockAdopted(3, [
      cartLine({
        id: 'line-foreign',
        item: { productId: 'prod-foreign' },
      }),
    ]);
    vi.mocked(fetchSharedCartProducts).mockResolvedValue(
      new Map([
        ['prod-foreign', product({ id: 'prod-foreign', name: 'Charger' })],
      ])
    );

    const { result } = renderHook(() =>
      useSharedCart({
        merchantId: MERCHANT_ID,
        merchantSlug: SLUG,
        sessionGeneration: 1,
      })
    );

    await waitFor(() => expect(result.current.cart[0]?.name).toBe('Charger'));
    expect(fetchSharedCartProducts).toHaveBeenCalledWith(
      ['prod-foreign'],
      MERCHANT_ID
    );
  });

  it('stays idle without a session until the first action bootstraps', async () => {
    vi.mocked(fetchSharedCartSnapshot).mockResolvedValue({
      code: 'unauthorized',
      ok: false,
      retryable: false,
      snapshot: null,
    });
    vi.mocked(bootstrapSharedCart).mockResolvedValue({ ok: true });
    vi.mocked(createSharedCart).mockResolvedValue({
      ok: true,
      replayed: false,
      snapshot: snapshot({ lines: [], version: 1 }),
      warnings: [],
    });
    vi.mocked(sendSharedCartCommand).mockResolvedValue({
      ok: true,
      replayed: false,
      snapshot: snapshot({
        lines: [
          cartLine({
            id: 'line-new',
            item: { productId: 'prod-9' },
          }),
        ],
        version: 2,
      }),
      warnings: [],
    });

    const { result } = renderHook(() =>
      useSharedCart({
        merchantId: MERCHANT_ID,
        merchantSlug: SLUG,
        sessionGeneration: 1,
      })
    );

    await waitFor(() =>
      expect(fetchSharedCartSnapshot).toHaveBeenCalledTimes(1)
    );
    expect(bootstrapSharedCart).not.toHaveBeenCalled();
    expect(result.current.cart).toHaveLength(0);

    await act(async () => {
      result.current.addToCart(product({ id: 'prod-9' }), 1);
    });
    // Optimistic feedback lands before the bootstrap round trips.
    expect(result.current.cart.map((line) => line.id)).toEqual(['prod-9']);

    await waitFor(() => expect(result.current.cartId).toBe(CART_ID));
    expect(bootstrapSharedCart).toHaveBeenCalledWith(SLUG);
    expect(createSharedCart).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendSharedCartCommand).mock.calls[0]?.[0]).toMatchObject({
      expectedVersion: 1,
      operationId: expect.any(String),
    });
    await waitFor(() =>
      expect(result.current.cart[0]?.serverLineId).toBe('line-new')
    );
  });

  it('re-bootstraps on first action when the proof expired', async () => {
    vi.mocked(fetchSharedCartSnapshot).mockResolvedValue({
      code: 'expired',
      ok: false,
      retryable: false,
      snapshot: null,
    });
    vi.mocked(bootstrapSharedCart).mockResolvedValue({ ok: true });
    vi.mocked(createSharedCart).mockResolvedValue({
      ok: true,
      replayed: false,
      snapshot: snapshot({ lines: [], version: 1 }),
      warnings: [],
    });
    vi.mocked(sendSharedCartCommand).mockResolvedValue({
      ok: true,
      replayed: false,
      snapshot: snapshot({ lines: [], version: 2 }),
      warnings: [],
    });

    const { result } = renderHook(() =>
      useSharedCart({
        merchantId: MERCHANT_ID,
        merchantSlug: SLUG,
        sessionGeneration: 1,
      })
    );
    await waitFor(() =>
      expect(fetchSharedCartSnapshot).toHaveBeenCalledTimes(1)
    );

    await act(async () => {
      result.current.addToCart(product({ id: 'prod-9' }), 1);
    });

    await waitFor(() => expect(bootstrapSharedCart).toHaveBeenCalledTimes(1));
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
it('bounds unavailable adoption and lets an explicit retry recover', async () => {
  vi.clearAllMocks();
  window.localStorage.clear();
  vi.mocked(fetchSharedCartProducts).mockResolvedValue(new Map());
  vi.useFakeTimers();
  try {
    vi.mocked(fetchSharedCartSnapshot).mockResolvedValue({
      ok: false,
      code: 'temporarily_unavailable',
      retryable: true,
      snapshot: null,
    });
    const { result } = renderHook(() =>
      useSharedCart({
        merchantId: MERCHANT_ID,
        merchantSlug: SLUG,
        sessionGeneration: 1,
      })
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(fetchSharedCartSnapshot).toHaveBeenCalledTimes(6);
    expect(result.current.syncStatus).toBe('error');
    vi.mocked(fetchSharedCartSnapshot).mockResolvedValue({
      ok: true,
      snapshot: snapshot({ lines: [] }),
      warnings: [],
    });
    await act(async () => {
      result.current.retryImport();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.syncStatus).toBe('synced');
    expect(result.current.cartId).toBe(CART_ID);
  } finally {
    vi.useRealTimers();
  }
});
it('ignores a superseded adoption reply after explicit retry starts a new run', async () => {
  vi.clearAllMocks();
  window.localStorage.clear();
  let finishOld!: (
    value: Awaited<ReturnType<typeof fetchSharedCartSnapshot>>
  ) => void;
  vi.mocked(fetchSharedCartProducts).mockResolvedValue(new Map());
  vi.mocked(fetchSharedCartSnapshot)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        })
    )
    .mockResolvedValue({
      ok: true,
      snapshot: snapshot({ version: 9 }),
      warnings: [],
    });
  const { result } = renderHook(() =>
    useSharedCart({
      merchantId: MERCHANT_ID,
      merchantSlug: SLUG,
      sessionGeneration: 1,
    })
  );
  await waitFor(() => expect(fetchSharedCartSnapshot).toHaveBeenCalledOnce());
  // An explicit retry while the first request is unresolved must invalidate it.
  act(() => result.current.retryPendingSync());
  await waitFor(() => expect(result.current.cartId).toBe(CART_ID));
  await act(async () => {
    finishOld({
      ok: true,
      snapshot: snapshot({ cartId: 'old-cart', version: 10 }),
      warnings: [],
    });
  });
  expect(result.current.cartId).toBe(CART_ID);
  expect(result.current.version).toBe(9);
});
