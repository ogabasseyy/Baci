import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fetchWithCsrf } from '@/lib/api-client';
import {
  CART_REQUEST_TIMEOUT_MS,
  withCartRequestDeadline,
} from './cart-request-deadline';
import { beginCartSessionRetirement } from './cart-session-write-fence';
import { fetchSharedCartSnapshot } from './shared-cart-client';
import {
  isCartDeviceRevocationPending,
  resetPendingCartDeviceRevocationsForTests,
  revokeCartDeviceSession,
} from './shared-cart-session-revoke-client';

// The global setup installs a LockManager mock; these suites exercise
// the synchronous no-Web-Locks fallback path instead.
beforeEach(() => {
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: undefined,
  });
});

vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: vi.fn() }));
let retirement: ReturnType<typeof beginCartSessionRetirement> | undefined;
afterEach(() => {
  retirement?.release();
  retirement = undefined;
  resetPendingCartDeviceRevocationsForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it('aborts a stalled snapshot and lets retirement drain with a retryable failure', async () => {
  vi.useFakeTimers();
  resetPendingCartDeviceRevocationsForTests();
  const fetchMock = vi
    .fn()
    .mockImplementation(() => new Promise(() => undefined));
  vi.stubGlobal('fetch', fetchMock);
  const request = fetchSharedCartSnapshot(undefined, 'shop');
  retirement = beginCartSessionRetirement('shop');
  const signal = fetchMock.mock.calls[0]?.[1]?.signal;
  await vi.advanceTimersByTimeAsync(CART_REQUEST_TIMEOUT_MS);
  expect(signal?.aborted).toBe(true);
  await expect(request).resolves.toMatchObject({ ok: false, retryable: true });
  await expect(retirement.drained).resolves.toBeUndefined();
});
it('fails closed and preserves a pending fence when revocation stalls', async () => {
  vi.useFakeTimers();
  resetPendingCartDeviceRevocationsForTests();
  vi.mocked(fetchWithCsrf).mockImplementationOnce(
    () => new Promise(() => undefined)
  );
  const request = revokeCartDeviceSession('shop');
  await vi.advanceTimersByTimeAsync(CART_REQUEST_TIMEOUT_MS);
  await expect(request).resolves.toEqual({ ok: false });
  expect(isCartDeviceRevocationPending('shop')).toBe(true);
});
it('does not start requests whose caller already canceled them', async () => {
  const controller = new AbortController();
  controller.abort();
  const request = vi.fn();
  await expect(
    withCartRequestDeadline(false, request, controller.signal)
  ).resolves.toBe(false);
  expect(request).not.toHaveBeenCalled();
});
