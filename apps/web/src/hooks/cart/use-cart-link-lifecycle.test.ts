import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resetCartSessionHintForTests,
  writeCartSessionHint,
} from './cart-session-hint';
import { saveCartToStorage } from './cart-storage';
import {
  bootstrapSharedCart,
  createSharedCart,
  fetchSharedCartProducts,
  fetchSharedCartSnapshot,
  sendSharedCartCommand,
} from './shared-cart-client';
import {
  CART_ID,
  cartItem,
  cartLine,
  MERCHANT_ID,
  mockAdopted,
  product,
  SLUG,
  snapshot,
} from './use-cart-link-lifecycle.test-support';
import { useSharedCart } from './use-shared-cart';

vi.mock('./shared-cart-client', () => ({
  bootstrapSharedCart: vi.fn(),
  createSharedCart: vi.fn(),
  fetchSharedCartProducts: vi.fn(),
  fetchSharedCartSnapshot: vi.fn(),
  sendSharedCartCommand: vi.fn(),
}));

describe('useSharedCart link', () => {
  afterEach(() => {
    resetCartSessionHintForTests();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    resetCartSessionHintForTests();
    writeCartSessionHint(MERCHANT_ID, '1');
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
});
