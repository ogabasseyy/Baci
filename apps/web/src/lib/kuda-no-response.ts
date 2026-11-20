import { KudaApiHttpError, KudaPreDispatchError } from './kuda-transport-error';

/**
 * Whether a failed Kuda price-list fetch means Kuda never gave an answer:
 * a timeout (408), rate limit (429) or server error (5xx), a failed login
 * before the request, a timeout or a dropped connection. Only then may a
 * saved price list stand in. Anything else is Kuda answering, definitely
 * (another 4xx) or with something Baci can't trust (empty, broken, priced in
 * the wrong unit), and the purchase is refused instead.
 */
export function isKudaNoResponse(error: unknown): boolean {
  if (error instanceof KudaApiHttpError) {
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }
  if (error instanceof KudaPreDispatchError) return true;
  if (error instanceof TypeError) return true; // fetch: connection failed
  if (error instanceof Error && error.name === 'AbortError') return true;
  return error instanceof Error && /\btime(?:d)?\s?out\b/i.test(error.message);
}
