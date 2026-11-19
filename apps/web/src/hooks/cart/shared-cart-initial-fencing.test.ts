import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { saveCartToStorage } from './cart-storage';
import {
  bootstrapSharedCart,
  createSharedCart,
  fetchSharedCartProducts,
  fetchSharedCartSnapshot,
} from './shared-cart-client';
import {
  cartItem,
  MERCHANT_ID,
  SLUG,
  snapshot,
} from './shared-cart-provisioning.test-support';
import { revokeCartDeviceSession } from './shared-cart-session-revoke-client';
import { useSharedCart } from './use-shared-cart';

vi.mock('./shared-cart-client', () => ({
  bootstrapSharedCart: vi.fn(),
  createSharedCart: vi.fn(),
  fetchSharedCartProducts: vi.fn(),
  fetchSharedCartSnapshot: vi.fn(),
  sendSharedCartCommand: vi.fn(),
}));
vi.mock('./shared-cart-session-revoke-client', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('./shared-cart-session-revoke-client')
  >()),
  revokeCartDeviceSession: vi.fn().mockResolvedValue({ ok: true }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  vi.useFakeTimers();
  saveCartToStorage([cartItem()], SLUG);
  vi.mocked(fetchSharedCartProducts).mockResolvedValue(new Map());
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
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it('does not create after enrollment is disabled while bootstrap is in flight', async () => {
  let finish: (value: { ok: true }) => void = () => undefined;
  vi.mocked(bootstrapSharedCart).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
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
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(bootstrapSharedCart).toHaveBeenCalledOnce();
  rerender({ enabled: false });
  await act(async () => {
    finish({ ok: true });
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(createSharedCart).not.toHaveBeenCalled();
  expect(revokeCartDeviceSession).toHaveBeenCalledWith(SLUG, {
    fenceOnFailure: true,
  });
});
it('waits for foreground if the tab becomes hidden during the initial read', async () => {
  let finish: (
    value: Awaited<ReturnType<typeof fetchSharedCartSnapshot>>
  ) => void = () => undefined;
  vi.mocked(fetchSharedCartSnapshot).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  let hidden = false;
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
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
  expect(fetchSharedCartSnapshot).toHaveBeenCalledOnce();
  hidden = true;
  await act(async () => {
    finish({
      code: 'unauthorized',
      ok: false,
      retryable: false,
      snapshot: null,
    });
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(bootstrapSharedCart).not.toHaveBeenCalled();
  expect(createSharedCart).not.toHaveBeenCalled();
  hidden = false;
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(result.current.cartId).toBe(snapshot().cartId);
});
it('rechecks foreground after bootstrap before creating', async () => {
  let finish: (value: { ok: true }) => void = () => undefined;
  vi.mocked(bootstrapSharedCart).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  let hidden = false;
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
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
  hidden = true;
  await act(async () => {
    finish({ ok: true });
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(createSharedCart).not.toHaveBeenCalled();
  hidden = false;
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(result.current.cartId).toBe(snapshot().cartId);
});

it('retires a creation response that arrives after enrollment is disabled', async () => {
  let finish: (value: Awaited<ReturnType<typeof createSharedCart>>) => void =
    () => undefined;
  vi.mocked(createSharedCart).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const { result, rerender } = renderHook(
    ({ enabled }) =>
      useSharedCart({
        enabled,
        merchantId: MERCHANT_ID,
        merchantSlug: SLUG,
        sessionGeneration: 1,
      }),
    { initialProps: { enabled: true } }
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(createSharedCart).toHaveBeenCalledOnce();
  rerender({ enabled: false });
  await act(async () => {
    finish({ ok: true, replayed: false, snapshot: snapshot(), warnings: [] });
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(revokeCartDeviceSession).toHaveBeenCalledWith(SLUG, {
    fenceOnFailure: true,
  });
  expect(result.current.cartId).toBeNull();
});

it('accepts a committed create while hidden and finishes the import receipt', async () => {
  let finish: (value: Awaited<ReturnType<typeof createSharedCart>>) => void =
    () => undefined;
  vi.mocked(createSharedCart).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  let hidden = false;
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
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
  expect(createSharedCart).toHaveBeenCalledOnce();
  hidden = true;
  await act(async () => {
    finish({ ok: true, replayed: false, snapshot: snapshot(), warnings: [] });
    await vi.advanceTimersByTimeAsync(1000);
  });
  hidden = false;
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(result.current.cartId).toBe(snapshot().cartId);
  expect(result.current.importStatus).toBe('done');
  expect(createSharedCart).toHaveBeenCalledOnce();
});
