// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startCheckoutVerificationPolling } from './start-checkout-verification-polling';
import {
  VERIFY_REPOLL_INTERVAL_MS,
  VERIFY_REPOLL_MAX_ATTEMPTS,
  VERIFY_REPOLL_SLOW_INTERVAL_MS,
  VERIFY_REQUEST_TIMEOUT_MS,
} from './verification-timing';

let active: ReturnType<typeof startCheckoutVerificationPolling> | undefined;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  active?.stop();
  active = undefined;
  vi.useRealTimers();
});

function start(
  verify = vi
    .fn<(signal: AbortSignal) => Promise<void>>()
    .mockResolvedValue(undefined)
) {
  active = startCheckoutVerificationPolling({ isPending: () => true, verify });
  active.start();
  return { polling: active, verify };
}

describe('startCheckoutVerificationPolling', () => {
  it('serializes requests and aborts a hung pass before polling again', async () => {
    const verify = vi
      .fn<(signal: AbortSignal) => Promise<void>>()
      .mockImplementationOnce(
        (signal) =>
          new Promise((resolve) => {
            signal.addEventListener('abort', () => resolve(), { once: true });
          })
      )
      .mockResolvedValue(undefined);
    start(verify);
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(VERIFY_REQUEST_TIMEOUT_MS - 1);
    expect(verify).toHaveBeenCalledTimes(1);
    const signal = verify.mock.calls[0]?.[0];
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1 + VERIFY_REPOLL_INTERVAL_MS);
    expect(signal?.aborted).toBe(true);
    expect(verify).toHaveBeenCalledTimes(2);
  });

  it('removes timers and visibility listeners when stopped', async () => {
    const { polling, verify } = start();
    await vi.advanceTimersByTimeAsync(0);
    polling.stop();
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.runAllTimersAsync();
    expect(verify).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('accelerates ordinary polls on focus but honors the rate-limit delay', async () => {
    const { polling, verify } = start();
    polling.delayNextPass(30_000);
    await vi.advanceTimersByTimeAsync(0);
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(verify).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(verify).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new Event('focus'));
    expect(verify).toHaveBeenCalledTimes(3);
  });

  it('stops at the maximum number of attempts even when still pending', async () => {
    const { verify } = start();
    await vi.advanceTimersByTimeAsync(
      VERIFY_REPOLL_MAX_ATTEMPTS * VERIFY_REPOLL_SLOW_INTERVAL_MS
    );
    expect(verify).toHaveBeenCalledTimes(VERIFY_REPOLL_MAX_ATTEMPTS);
    expect(vi.getTimerCount()).toBe(0);
  });
});
