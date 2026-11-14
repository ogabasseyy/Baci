/** Returns true when either locally tracked clock reaches or exceeds a deadline. */
export function isSharedCartCheckoutDeadlineExpired(
  monotonicDeadlineMs: number | null | undefined,
  epochDeadlineMs: number | null | undefined,
  monotonicNowMs = performance.now(),
  epochNowMs = Date.now()
): boolean {
  if (
    typeof monotonicDeadlineMs !== 'number' ||
    !Number.isFinite(monotonicDeadlineMs) ||
    typeof epochDeadlineMs !== 'number' ||
    !Number.isFinite(epochDeadlineMs) ||
    !Number.isFinite(monotonicNowMs) ||
    !Number.isFinite(epochNowMs)
  ) {
    return true;
  }
  return monotonicNowMs >= monotonicDeadlineMs || epochNowMs >= epochDeadlineMs;
}
