import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import {
  fetchSharedCartProducts,
  fetchSharedCartSnapshot,
} from './shared-cart-client';
import { snapshot } from './shared-cart-provisioning.test-support';
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
