import {
  VERIFY_REPOLL_FAST_MAX_ATTEMPTS,
  VERIFY_REPOLL_INTERVAL_MS,
  VERIFY_REPOLL_MAX_ATTEMPTS,
  VERIFY_REPOLL_SLOW_INTERVAL_MS,
  VERIFY_REQUEST_TIMEOUT_MS,
} from './verification-timing';

export function startCheckoutVerificationPolling({
  isPending,
  verify,
}: {
  isPending: () => boolean;
  verify: (signal: AbortSignal) => Promise<void>;
}) {
  let stopped = false;
  let reverifyTimer: ReturnType<typeof setTimeout> | null = null;
  let reverifyAttempts = 0;
  let retryAfterMs = 0;
  let passInFlight = false;
  let passController: AbortController | null = null;
  let passTimeout: ReturnType<typeof setTimeout> | null = null;
  const clearReverifyTimer = () => {
    if (reverifyTimer !== null) {
      clearTimeout(reverifyTimer);
      reverifyTimer = null;
    }
  };
  const abortPass = () => {
    if (passTimeout !== null) {
      clearTimeout(passTimeout);
      passTimeout = null;
    }
    if (passController !== null) {
      passController.abort();
      passController = null;
    }
  };
  // Serialize bounded requests so stale responses cannot overwrite a newer result.
  const runVerificationPass = () => {
    // React may commit the terminal state after the current promise settles.
    // Check again before sending a request so a stale timer cannot
    // overwrite a confirmed payment.
    if (
      stopped ||
      passInFlight ||
      !isPending() ||
      reverifyAttempts >= VERIFY_REPOLL_MAX_ATTEMPTS
    ) {
      return;
    }
    reverifyAttempts += 1;
    retryAfterMs = 0;
    passInFlight = true;
    passController = new AbortController();
    passTimeout = setTimeout(() => {
      passController?.abort();
    }, VERIFY_REQUEST_TIMEOUT_MS);
    void verify(passController.signal).finally(() => {
      if (passTimeout !== null) {
        clearTimeout(passTimeout);
        passTimeout = null;
      }
      passController = null;
      passInFlight = false;
      if (
        stopped ||
        !isPending() ||
        reverifyAttempts >= VERIFY_REPOLL_MAX_ATTEMPTS
      ) {
        return;
      }
      const interval =
        reverifyAttempts < VERIFY_REPOLL_FAST_MAX_ATTEMPTS
          ? VERIFY_REPOLL_INTERVAL_MS
          : VERIFY_REPOLL_SLOW_INTERVAL_MS;
      reverifyTimer = setTimeout(
        () => {
          reverifyTimer = null;
          runVerificationPass();
        },
        Math.max(interval, retryAfterMs)
      );
    });
  };
  // The shopper returned while a slow-lane wait was pending: revalidate
  // now instead of making them wait out the backoff.
  const revalidateOnVisible = () => {
    if (
      typeof document !== 'undefined' &&
      document.visibilityState === 'hidden'
    ) {
      return;
    }
    if (stopped || passInFlight || reverifyTimer === null) {
      return;
    }
    if (!isPending() || reverifyAttempts >= VERIFY_REPOLL_MAX_ATTEMPTS) {
      return;
    }
    clearReverifyTimer();
    runVerificationPass();
  };
  return {
    delayNextPass(delayMs: number) {
      retryAfterMs = delayMs;
    },
    start() {
      window.addEventListener('focus', revalidateOnVisible);
      document.addEventListener('visibilitychange', revalidateOnVisible);
      runVerificationPass();
    },
    stop() {
      stopped = true;
      clearReverifyTimer();
      abortPass();
      window.removeEventListener('focus', revalidateOnVisible);
      document.removeEventListener('visibilitychange', revalidateOnVisible);
    },
  };
}
