import { KudaApiHttpError, KudaPreDispatchError } from './kuda-transport-error';

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
  // Codes only, never message text: a broken answer's parse error can quote
  // the body (e.g. "socket hang up"), which must not read as silence. A real
  // hang-up carries ECONNRESET.
  return codes.some(
    (code) => typeof code === 'string' && NETWORK_ERROR_CODES.has(code)
  );
}

/** A timeout, rate limit or server error: Kuda gave no usable answer. */
function isTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/**
 * Whether a failed Kuda price-list fetch means Kuda never gave an answer:
 * a timeout (408), rate limit (429) or server error (5xx), a login that
 * never reached Kuda or was answered the same way, a request timeout or a
 * dropped connection. Only then may a saved price list stand in. Anything
 * else is Kuda answering, definitely (another 4xx, including a 401/403 on
 * login) or with something Baci can't trust (empty, broken, priced in the
 * wrong unit), and the purchase is refused instead.
 */
export function isKudaNoResponse(error: unknown): boolean {
  if (error instanceof KudaApiHttpError) return isTransientStatus(error.status);
  if (error instanceof KudaPreDispatchError) {
    return error.status === undefined || isTransientStatus(error.status);
  }
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
  // kudaRequest's own timeout, by its exact wording, so another error that
  // merely mentions a timeout is never mistaken for silence.
  return (
    error instanceof Error && /^Kuda \S+ request timed out$/.test(error.message)
  );
}
