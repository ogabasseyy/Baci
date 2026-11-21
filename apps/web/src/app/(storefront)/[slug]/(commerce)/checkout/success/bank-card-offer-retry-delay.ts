const DEFAULT_RETRY_AFTER_MS = 15_000;
const MAX_RETRY_AFTER_MS = 5 * 60_000;

export function bankCardOfferRetryDelay(response: Response): number {
  if (response.status !== 429 && response.status !== 503) return 0;
  const retryAfter = response.headers.get('Retry-After')?.trim();
  if (!retryAfter) return DEFAULT_RETRY_AFTER_MS;
  const delay = /^\d+$/.test(retryAfter)
    ? Number(retryAfter) * 1000
    : Date.parse(retryAfter) - Date.now();
  return delay > 0
    ? Math.min(MAX_RETRY_AFTER_MS, delay)
    : DEFAULT_RETRY_AFTER_MS;
}
