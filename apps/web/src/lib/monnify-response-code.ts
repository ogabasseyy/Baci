/**
 * A Monnify response code is short and code-shaped (e.g. "99", "D02",
 * "MP_001"). Anything else is dropped so free text, a phone number (5+
 * digits in a row) or a token can never be stored as a "code".
 */
const MONNIFY_RESPONSE_CODE_SHAPE = /^(?!.*\d{5})[A-Za-z0-9_-]{1,12}$/;

/**
 * Monnify's own response code from an answer's top-level `responseCode`
 * (string or number), kept on failed rows so a refusal can be diagnosed
 * (for example, whether "Insufficient funds" came with code 99).
 */
export function readMonnifyResponseCode(answer: unknown): string | undefined {
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) {
    return undefined;
  }
  const value = (answer as Record<string, unknown>).responseCode;
  if (typeof value !== 'string' && typeof value !== 'number') {
    return undefined;
  }
  const code = String(value).trim();
  return MONNIFY_RESPONSE_CODE_SHAPE.test(code) ? code : undefined;
}
