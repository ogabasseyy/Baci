/**
 * Response codes that never prove Monnify vended nothing: 99 ("unexpected
 * error, re-query"), 408 (timeout), 409 (conflict/duplicate), 429
 * (throttle), Monnify's success code 0 (contradictory on a rejection), any 2xx (accepted/processing, e.g. 202) and any 5xx
 * (upstream server error).
 */
const NON_DEFINITIVE_CODE = /^(?:0+|0*(?:99|2\d\d|408|409|429|5\d\d))$/;
/**
 * Keys that carry a response code: code, responseCode, error_code, and a
 * generic status / statusCode (a numeric 408 there is a timeout, not data).
 */
const RESPONSE_CODE_KEY =
  /^(?:(?:response|error|result|status|http)?code|(?:http|response|result)?status(?:code)?)$/;
const MAX_DEPTH = 6;

function isNonDefinitiveValue(value: unknown): boolean {
  return (
    (typeof value === 'string' || typeof value === 'number') &&
    NON_DEFINITIVE_CODE.test(String(value).trim())
  );
}

/**
 * Whether any response-code field in a Monnify answer, at any depth (the
 * envelope's own responseCode or one nested in responseBody), is 99, 408,
 * 409 or 429.
 */
export function hasMonnifyNonDefinitiveCode(
  answer: unknown,
  depth = 0
): boolean {
  if (depth > MAX_DEPTH || !answer || typeof answer !== 'object') {
    return false;
  }
  if (Array.isArray(answer)) {
    return answer.some((item) => hasMonnifyNonDefinitiveCode(item, depth + 1));
  }
  return Object.entries(answer).some(([key, value]) => {
    const normalisedKey = key.replace(/[_-]/g, '').toLowerCase();
    return (
      (RESPONSE_CODE_KEY.test(normalisedKey) && isNonDefinitiveValue(value)) ||
      hasMonnifyNonDefinitiveCode(value, depth + 1)
    );
  });
}
