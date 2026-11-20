import { KudaApiHttpError, KudaPreDispatchError } from './kuda-transport-error';

/**
 * Whether a failed Kuda price-list fetch means Kuda never gave an answer:
 * a timeout (408), rate limit (429) or server error (5xx), a failed login
 * before the request, a timeout or a dropped connection. Only then may a
 * saved price list stand in. Anything else is Kuda answering, definitely
 * (another 4xx) or with something Baci can't trust (empty, broken, priced in
 * the wrong unit), and the purchase is refused instead.
 */
/** Node's connection failure codes, on the error or its cause. */
const NETWORK_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

function hasNetworkErrorCode(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const codes = [
    (error as { code?: unknown }).code,
    (error.cause as { code?: unknown } | undefined)?.code,
  ];
  return (
    codes.some(
      (code) => typeof code === 'string' && NETWORK_ERROR_CODES.has(code)
    ) || /socket hang up/i.test(error.message)
  );
}

export function isKudaNoResponse(error: unknown): boolean {
  if (error instanceof KudaApiHttpError) {
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }
  if (error instanceof KudaPreDispatchError) return true;
  if (hasNetworkErrorCode(error)) return true;
  // fetch rejects with a TypeError whose message names the network failure;
  // a TypeError from reading a broken answer ("Cannot read properties of
  // null") is Kuda answering badly, so it is refused, not treated as silence.
  if (error instanceof TypeError) {
    return /fetch failed|failed to fetch|network ?error|load failed/i.test(
      error.message
    );
  }
  if (error instanceof Error && error.name === 'AbortError') return true;
  return error instanceof Error && /\btime(?:d)?\s?out\b/i.test(error.message);
}
