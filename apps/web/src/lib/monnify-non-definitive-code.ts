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
 * refundable (owner decision 2026-11-18 for 401/403).
 */
const UNRESOLVED_CODE = /^0*(?:99|2\d\d|408|409|5\d\d)$/;

function hasResponseCodeMatching(
  answer: unknown,
  pattern: RegExp,
  depth: number
): boolean {
  if (!answer || typeof answer !== 'object') {
    return false;
  }
  // Nesting deeper than we scan can't be cleared: fail closed.
  if (depth > MAX_DEPTH) {
    return true;
  }
  if (Array.isArray(answer)) {
    return answer.some((item) =>
      hasResponseCodeMatching(item, pattern, depth + 1)
    );
  }
  return Object.entries(answer).some(([key, value]) => {
    const normalisedKey = key.replace(/[\s_-]/g, '').toLowerCase();
    return (
      (RESPONSE_CODE_KEY.test(normalisedKey) &&
        (Array.isArray(value) ? value : [value]).some(
          (item) =>
            (typeof item === 'string' || typeof item === 'number') &&
            pattern.test(String(item).trim())
        )) ||
      hasResponseCodeMatching(value, pattern, depth + 1)
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
