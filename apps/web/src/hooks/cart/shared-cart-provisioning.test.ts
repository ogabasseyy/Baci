import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCartFromStorage, saveCartToStorage } from './cart-storage';
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
  product,
  SLUG,
  snapshot,
} from './shared-cart-provisioning.test-support';
import { useSharedCart } from './use-shared-cart';

vi.mock('./shared-cart-client', () => ({
  bootstrapSharedCart: vi.fn(),
  createSharedCart: vi.fn(),
  fetchSharedCartProducts: vi.fn(),
  fetchSharedCartSnapshot: vi.fn(),
  sendSharedCartCommand: vi.fn(),
}));

describe('useSharedCart legacy import', () => {
  afterEach(() => vi.useRealTimers());
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    vi.mocked(fetchSharedCartProducts).mockResolvedValue(new Map());
  });

  it('keeps creation pending and retries its exact cached lines after an unknown outcome', async () => {
    vi.useFakeTimers();
    saveCartToStorage([cartItem({ quantity: 2 })], SLUG);
    vi.mocked(fetchSharedCartSnapshot).mockResolvedValue({
      code: 'unauthorized',
      ok: false,
      retryable: false,
      snapshot: null,
    });
    vi.mocked(bootstrapSharedCart).mockResolvedValue({ ok: true });
    let finish: (value: Awaited<ReturnType<typeof createSharedCart>>) => void =
      () => undefined;
    vi.mocked(createSharedCart)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          })
      )
      .mockResolvedValue({
        ok: true,
        replayed: true,
        snapshot: snapshot({ version: 1 }),
        warnings: [],
      });
    vi.mocked(sendSharedCartCommand).mockResolvedValue({
      ok: true,
      replayed: false,
      snapshot: snapshot({ version: 2 }),
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
    act(() => result.current.addToCart(product({ id: 'prod-9' }), 1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(createSharedCart).toHaveBeenCalledTimes(1);
    expect(result.current.importStatus).toBe('pending');
    expect(result.current.syncStatus).not.toBe('retrying');
    expect(result.current.syncError).toBeNull();
    await act(async () => {
      finish({
        ok: false,
        code: 'temporarily_unavailable',
        retryable: true,
        snapshot: null,
      });
    });
    // Linking owns the automatic retry even when no new edit is made.
    // Changing the device cache must not change the indeterminate request.
    saveCartToStorage([cartItem({ quantity: 7 })], SLUG);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(createSharedCart).toHaveBeenCalledTimes(2);
    expect(vi.mocked(createSharedCart).mock.calls[1][0]).toEqual(
      vi.mocked(createSharedCart).mock.calls[0][0]
    );
    expect(result.current.importStatus).toBe('done');
  });

  it('blocks an over-capacity first import instead of creating an empty cart', async () => {
    saveCartToStorage(
      Array.from({ length: 21 }, (_, index) =>
        cartItem({
          cartItemId: `prod-${index}`,
          id: `prod-${index}`,
        })
      ),
      SLUG
    );
    vi.mocked(fetchSharedCartSnapshot).mockResolvedValue({
      code: 'unauthorized',
      ok: false,
      retryable: false,
      snapshot: null,
    });
    vi.mocked(bootstrapSharedCart).mockResolvedValue({ ok: true });
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
    act(() => result.current.addToCart(product({ id: 'prod-new' }), 1));
    await waitFor(() => expect(result.current.importStatus).toBe('failed'));
    expect(result.current.importWarnings).toContain('import_capacity_exceeded');
    expect(createSharedCart).not.toHaveBeenCalled();
    // The legacy cache survives for an explicit retry after trimming.
    expect(getCartFromStorage(SLUG)).toHaveLength(21);
  });

  it('creates with the cached lines on the first action and records the receipt', async () => {
    saveCartToStorage(
      [cartItem({ id: 'prod-1', price: 100, quantity: 2 })],
      SLUG
    );
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
      snapshot: snapshot({
        lines: [cartLine({ lineTotalMinor: 20000, quantity: 2 })],
        version: 1,
      }),
      warnings: [],
    });
    vi.mocked(sendSharedCartCommand).mockResolvedValue({
      ok: true,
      replayed: false,
      snapshot: snapshot({
        lines: [
          cartLine({ lineTotalMinor: 20000, quantity: 2 }),
          cartLine({
            id: 'line-9',
            item: { productId: 'prod-9' },
            quantity: 1,
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

    await act(async () => {
      result.current.addToCart(product({ id: 'prod-9' }), 1);
    });

    await waitFor(() => expect(createSharedCart).toHaveBeenCalledTimes(1));
    expect(vi.mocked(createSharedCart).mock.calls[0]?.[0]).toMatchObject({
      lines: [{ item: { productId: 'prod-1' }, quantity: 2 }],
      operationId: expect.stringMatching(/^import:/),
    });
    await waitFor(() => expect(result.current.importStatus).toBe('done'));
    // The user action sends after the import lands.
    await waitFor(() =>
      expect(vi.mocked(sendSharedCartCommand)).toHaveBeenCalledTimes(1)
    );
    // The receipt pins this cart as imported; the old cache key survives
    // until the receipt exists (it does now).
    const { getSharedCartImportReceipt } = await import('./cart-storage');
    expect(getSharedCartImportReceipt(SLUG)).toMatchObject({
      cartId: CART_ID,
      lineCount: 1,
    });
  });

  it('coalesces parallel host requests into one empty-cart provisioning flight', async () => {
    vi.mocked(fetchSharedCartSnapshot).mockResolvedValue({
      code: 'not_found',
      ok: false,
      retryable: false,
      snapshot: null,
    });
    let finishCreate: (
      value: Awaited<ReturnType<typeof createSharedCart>>
    ) => void = () => undefined;
    vi.mocked(createSharedCart).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishCreate = resolve;
        })
    );
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
    await waitFor(() => expect(result.current.importStatus).toBe('skipped'));

    const flights: ReturnType<typeof result.current.ensureCartSession>[] = [];
    act(() => {
      flights.push(
        result.current.ensureCartSession(),
        result.current.ensureCartSession()
      );
    });
    await waitFor(() => expect(createSharedCart).toHaveBeenCalledTimes(1));
    expect(bootstrapSharedCart).not.toHaveBeenCalled();

    await act(async () => {
      finishCreate({
        ok: true,
        replayed: false,
        snapshot: snapshot({ lines: [], version: 1 }),
        warnings: [],
      });
      await Promise.all(flights);
    });
    expect(await Promise.all(flights)).toEqual([{ ok: true }, { ok: true }]);
    expect(createSharedCart).toHaveBeenCalledTimes(1);
  });

  it('starts a separate session flight after a merchant change and ignores the stale create', async () => {
    vi.mocked(fetchSharedCartSnapshot).mockResolvedValue({
      code: 'not_found',
      ok: false,
      retryable: false,
      snapshot: null,
    });
    let finishOldCreate: (
      value: Awaited<ReturnType<typeof createSharedCart>>
    ) => void = () => undefined;
    vi.mocked(createSharedCart)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishOldCreate = resolve;
          })
      )
      .mockResolvedValueOnce({
        ok: true,
        replayed: false,
        snapshot: snapshot({
          cartId: '33333333-3333-4333-8333-333333333333',
          lines: [],
          version: 1,
        }),
        warnings: [],
      });
    const { result, rerender } = renderHook(
      ({ merchantSlug }: { merchantSlug: string }) =>
        useSharedCart({
          merchantId: MERCHANT_ID,
          merchantSlug,
          sessionGeneration: merchantSlug === SLUG ? 1 : 2,
        }),
      { initialProps: { merchantSlug: SLUG } }
    );
    await waitFor(() =>
      expect(fetchSharedCartSnapshot).toHaveBeenCalledTimes(1)
    );
    await waitFor(() => expect(result.current.importStatus).toBe('skipped'));

    let oldSessionFlight:
      | ReturnType<typeof result.current.ensureCartSession>
      | undefined;
    act(() => {
      oldSessionFlight = result.current.ensureCartSession();
    });
    await waitFor(() => expect(createSharedCart).toHaveBeenCalledTimes(1));

    rerender({ merchantSlug: 'other-merchant' });
    await waitFor(() =>
      expect(fetchSharedCartSnapshot).toHaveBeenCalledTimes(2)
    );
    await waitFor(() => expect(result.current.importStatus).toBe('skipped'));
    let currentSessionFlight:
      | ReturnType<typeof result.current.ensureCartSession>
      | undefined;
    act(() => {
      currentSessionFlight = result.current.ensureCartSession();
    });
    await waitFor(() => expect(createSharedCart).toHaveBeenCalledTimes(2));
    await expect(currentSessionFlight).resolves.toEqual({ ok: true });
    await waitFor(() =>
      expect(result.current.cartId).toBe('33333333-3333-4333-8333-333333333333')
    );

    await act(async () => {
      finishOldCreate({
        ok: true,
        replayed: false,
        snapshot: snapshot({
          cartId: '44444444-4444-4444-8444-444444444444',
          lines: [],
          version: 1,
        }),
        warnings: [],
      });
      await expect(oldSessionFlight).resolves.toBeNull();
    });
    expect(result.current.cartId).toBe('33333333-3333-4333-8333-333333333333');
  });

  it('recovers the first action when cart creation fails transiently', async () => {
    vi.mocked(fetchSharedCartSnapshot).mockResolvedValue({
      code: 'unauthorized',
      ok: false,
      retryable: false,
      snapshot: null,
    });
    vi.mocked(bootstrapSharedCart).mockResolvedValue({ ok: true });
    vi.mocked(createSharedCart)
      .mockResolvedValueOnce({
        code: 'temporarily_unavailable',
        ok: false,
        retryable: true,
        snapshot: null,
      })
      .mockResolvedValue({
        ok: true,
        replayed: false,
        snapshot: snapshot({ lines: [], version: 1 }),
        warnings: [],
      });
    vi.mocked(sendSharedCartCommand).mockResolvedValue({
      ok: true,
      replayed: false,
      snapshot: snapshot({
        lines: [cartLine({ id: 'line-9', item: { productId: 'prod-9' } })],
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

    await act(async () => {
      result.current.addToCart(product({ id: 'prod-9' }), 1);
    });

    // The transient failure surfaces on the head entry instead of
    // stalling it silently in the queue.
    await waitFor(() => expect(result.current.syncStatus).toBe('retrying'));
    expect(result.current.syncError).toBe('temporarily_unavailable');

    await act(async () => {
      result.current.retryPendingSync();
    });
    await waitFor(() =>
      expect(vi.mocked(createSharedCart)).toHaveBeenCalledTimes(2)
    );
    await waitFor(() =>
      expect(vi.mocked(sendSharedCartCommand)).toHaveBeenCalledTimes(1)
    );
    await waitFor(() => expect(result.current.syncStatus).toBe('synced'));
    expect(result.current.cart.map((line) => line.id)).toEqual(['prod-9']);
  });
});
