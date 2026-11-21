const DEFAULT_RETRY_AFTER_MS = 15_000;
const MAX_RETRY_AFTER_MS = 5 * 60_000;

export function bankCardOfferRetryDelay(response: Response): number {
  const fallback =
    response.status === 429 || response.status === 503
      ? DEFAULT_RETRY_AFTER_MS
      : 0;
  const retryAfter = response.headers.get('Retry-After')?.trim();
  if (!retryAfter) return fallback;
  // The verification API sends delta-seconds. For an intermediary's absolute
  // date, use the response clock when available and avoid device clock skew.
  const serverTime = Date.parse(response.headers.get('Date') ?? '');
  const delay = /^\d+$/.test(retryAfter)
    ? Number(retryAfter) * 1000
    : Date.parse(retryAfter) - serverTime;
  return delay > 0 ? Math.min(MAX_RETRY_AFTER_MS, delay) : fallback;
}
