import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resetCartSessionHintForTests,
  writeCartSessionHint,
} from './cart-session-hint';
import {
  bootstrapSharedCart,
  createSharedCart,
  fetchSharedCartProducts,
  fetchSharedCartSnapshot,
} from './shared-cart-client';
import {
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

describe('useSharedCart provisioning concurrency', () => {
  afterEach(() => {
    vi.useRealTimers();
    resetCartSessionHintForTests();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    resetCartSessionHintForTests();
    writeCartSessionHint(MERCHANT_ID, '1');
    vi.mocked(fetchSharedCartProducts).mockResolvedValue(new Map());
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
});
