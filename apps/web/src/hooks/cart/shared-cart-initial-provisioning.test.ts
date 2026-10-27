import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSharedCartImportReceipt, saveCartToStorage } from './cart-storage';
import {
  bootstrapSharedCart,
  createSharedCart,
  fetchSharedCartProducts,
  fetchSharedCartSnapshot,
  sendSharedCartCommand,
} from './shared-cart-client';
import * as provisioning from './shared-cart-provisioning';
import {
  CART_ID,
  cartItem,
  MERCHANT_ID,
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
describe('initial device cart recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    vi.mocked(fetchSharedCartProducts).mockResolvedValue(new Map());
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  it.each([
    'unauthorized',
    'not_found',
  ] as const)('imports a saved device cart after %s without another cart edit', async (code) => {
    saveCartToStorage([cartItem()], SLUG);
    vi.mocked(fetchSharedCartSnapshot).mockResolvedValue({
      code,
      ok: false,
      retryable: false,
      snapshot: null,
    });
    vi.mocked(bootstrapSharedCart).mockResolvedValue({ ok: true });
    vi.mocked(createSharedCart).mockResolvedValue({
      ok: true,
      replayed: false,
      snapshot: snapshot(),
      warnings: [],
    });
    const { result } = renderHook(() =>
      useSharedCart({
        merchantId: MERCHANT_ID,
        merchantSlug: SLUG,
        sessionGeneration: 1,
      })
    );
    await waitFor(() => expect(result.current.cartId).toBe(CART_ID));
    expect(result.current.syncStatus).toBe('synced');
    expect(createSharedCart).toHaveBeenCalledWith(
      expect.objectContaining({
        lines: [expect.objectContaining({ quantity: 1 })],
      }),
      SLUG
    );
    expect(sendSharedCartCommand).not.toHaveBeenCalled();
  });

  it('replays the same saved-cart import after an indeterminate create', async () => {
    vi.useFakeTimers();
    saveCartToStorage([cartItem()], SLUG);
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
        replayed: true,
        snapshot: snapshot(),
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
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(result.current.cartId).toBe(CART_ID);
    expect(createSharedCart).toHaveBeenCalledTimes(2);
    expect(vi.mocked(createSharedCart).mock.calls[1]).toEqual(
      vi.mocked(createSharedCart).mock.calls[0]
    );
    expect(result.current.cart).toHaveLength(1);
    expect(sendSharedCartCommand).not.toHaveBeenCalled();
  });

  it('reconciles a committed create by replaying it instead of adopting past its receipt', async () => {
    vi.useFakeTimers();
    saveCartToStorage([cartItem()], SLUG);
    vi.mocked(fetchSharedCartSnapshot)
      .mockResolvedValueOnce({
        code: 'unauthorized',
        ok: false,
        retryable: false,
        snapshot: null,
      })
      .mockResolvedValue({ ok: true, snapshot: snapshot(), warnings: [] });
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
        replayed: true,
        snapshot: snapshot(),
        warnings: [],
      });
    vi.mocked(sendSharedCartCommand).mockResolvedValue({
      ok: true,
      replayed: false,
      snapshot: snapshot({ lines: [], version: 4 }),
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
    expect(createSharedCart).toHaveBeenCalledTimes(1);
    // A foreground/manual read can observe the committed cart before the
    // create response is reconciled. It must not replace the create replay.
    await act(async () => result.current.refreshSharedCart());
    expect(result.current.cartId).toBe(CART_ID);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(result.current.importStatus).toBe('done');
    expect(createSharedCart).toHaveBeenCalledTimes(2);
    expect(vi.mocked(createSharedCart).mock.calls[1]).toEqual(
      vi.mocked(createSharedCart).mock.calls[0]
    );
    expect(getSharedCartImportReceipt(SLUG)).toMatchObject({
      cartId: CART_ID,
      lineCount: 1,
    });
    act(() => result.current.removeFromCart('prod-1'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.version).toBe(4);
    expect(result.current.cart).toEqual([]);
  });

  it('retries busy provisioning within the same live generation', async () => {
    vi.useFakeTimers();
    saveCartToStorage([cartItem()], SLUG);
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
      snapshot: snapshot(),
      warnings: [],
    });
    const actual = provisioning.createCartProvisioning;
    let busy = true;
    vi.spyOn(provisioning, 'createCartProvisioning').mockImplementation(
      (context) => {
        const provision = actual(context);
        return {
          ...provision,
          ensureCart: async () => {
            if (busy) {
              busy = false;
              return null;
            }
            return provision.ensureCart();
          },
        };
      }
    );
    const { result } = renderHook(() =>
      useSharedCart({
        merchantId: MERCHANT_ID,
        merchantSlug: SLUG,
        sessionGeneration: 1,
      })
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(result.current.cartId).toBe(CART_ID);
    expect(result.current.importStatus).toBe('done');
  });
});
