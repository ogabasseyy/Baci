import { NON_VEND_PARENT } from './monnify-structured-outcome';

/**
 * Response codes that never prove Monnify vended nothing: 99 ("unexpected
 * error, re-query"), 408 (timeout), 409 (conflict/duplicate), 429
 * (throttle), 401/403 (login rejection, owner decision 2026-11-18), Monnify's success code 0 (contradictory on a rejection), any 2xx (accepted/processing, e.g. 202) and any 5xx
 * (upstream server error).
 */
const NON_DEFINITIVE_CODE = /^(?:0+|0*(?:99|2\d\d|401|403|408|409|429|5\d\d))$/;
/**
 * Keys that carry a response code: code, responseCode, error_code, and a
 * generic status / statusCode (a numeric 408 there is a timeout, not data).
 */
const RESPONSE_CODE_KEY =
  /^(?:(?:response|error|result|status|http)?code|(?:http|response|result)?status(?:code)?)$/;
const MAX_DEPTH = 6;

/**
 * Response codes that leave a vend's outcome open: 99 ("unexpected error,
 * re-query"), 2xx (accepted/processing), 408 (timeout), 409 (duplicate) and
 * 5xx (upstream error). Narrower than NON_DEFINITIVE_CODE: 401/403 login
 * rejections and 429 throttles are refused before any vend and stay
 * refundable (owner decision 2026-11-18 for 401/403). Monnify's success
 * code 0 on a rejection is contradictory, so it leaves the outcome open too.
 */
const UNRESOLVED_CODE = /^(?:0+|0*(?:99|2\d\d|408|409|5\d\d))$/;

/** A bare `code` under these parents is a catalog code, not a response code. */
const CATALOG_PARENT =
  /^(?:product|biller|item|service|customer|package|plan)s?$/;

/** The leading 3-digit HTTP-style code of "500 Internal Server Error", else the trimmed value. */
function leadingCode(value: string): string {
  const trimmed = value.trim();
  return /^\d{3}(?!\d)/.exec(trimmed)?.[0] ?? trimmed;
}

function hasResponseCodeMatching(
  answer: unknown,
  pattern: RegExp,
  depth: number,
  underCatalog = false,
  overflowResult = true,
  skipAncillary = false
): boolean {
  if (!answer || typeof answer !== 'object') {
    return false;
  }
  // Nesting deeper than we scan can't be cleared: fail closed (for the
  // open-code scans). The auth scan passes false: overflow is not a match.
  if (depth > MAX_DEPTH) {
    return overflowResult;
  }
  if (Array.isArray(answer)) {
    return answer.some((item) =>
      hasResponseCodeMatching(
        item,
        pattern,
        depth + 1,
        underCatalog,
        overflowResult,
        skipAncillary
      )
    );
  }
  return Object.entries(answer).some(([key, value]) => {
    const normalisedKey = key.replace(/[\s_-]/g, '').toLowerCase();
    const isCatalogCode = normalisedKey === 'code' && underCatalog;
    // The auth scan ignores codes under refund/request/error/... objects.
    if (skipAncillary && NON_VEND_PARENT.test(normalisedKey)) {
      return false;
    }
    return (
      (RESPONSE_CODE_KEY.test(normalisedKey) &&
        !isCatalogCode &&
        (Array.isArray(value) ? value : [value]).some(
          (item) =>
            (typeof item === 'string' || typeof item === 'number') &&
            // "500 Internal Server Error": the leading code is what counts.
            pattern.test(leadingCode(String(item)))
        )) ||
      hasResponseCodeMatching(
        value,
        pattern,
        depth + 1,
        underCatalog || CATALOG_PARENT.test(normalisedKey),
        overflowResult,
        skipAncillary
      )
    );
  });
}

/**
 * Whether any response-code field in a Monnify answer, at any depth (the
 * envelope's own responseCode or one nested in responseBody), is one of the
 * non-definitive codes above.
 */
export function hasMonnifyNonDefinitiveCode(
  answer: unknown,
  depth = 0
): boolean {
  return hasResponseCodeMatching(answer, NON_DEFINITIVE_CODE, depth);
}

/**
 * Whether any response-code field in a Monnify answer leaves the vend's
 * outcome open (UNRESOLVED_CODE): such an answer is never refunded at once.
 */
export function hasMonnifyUnresolvedCode(answer: unknown): boolean {
  return hasResponseCodeMatching(answer, UNRESOLVED_CODE, 0);
}

/**
 * Whether any response-code field in a Monnify answer, at any depth, is a
 * login rejection or throttle (401/403/429): such an answer proves nothing
 * about the vend.
 */
export function hasMonnifyAuthOrThrottleCode(answer: unknown): boolean {
  // Too deeply nested to scan is NOT an auth match: it would skip the open
  // checks and refund an answer we could not read.
  return hasResponseCodeMatching(
    answer,
    /^0*(?:401|403|429)$/,
    0,
    false,
    false,
    true
  );
}
