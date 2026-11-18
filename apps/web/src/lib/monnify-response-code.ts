/**
 * A Monnify response code is code-shaped, with at most 4 digits in all:
 * either short (up to 12 characters, e.g. "99", "D02", "MP_001") or an
 * upper-case snake-case name up to 40 characters (e.g.
 * "DUPLICATE_REFERENCE"). Anything else is dropped so free text, a phone
 * number (grouped or not) or a mixed-case token can never be stored as a
 * "code".
 */
const MONNIFY_RESPONSE_CODE_SHAPE =
  /^(?!(?:\D*\d){5})(?:[A-Za-z0-9_-]{1,12}|[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)$/;
const MONNIFY_RESPONSE_CODE_MAX_LENGTH = 40;

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
  if (
    typeof value !== 'string' &&
    !(typeof value === 'number' && Number.isFinite(value))
  ) {
    return undefined;
  }
  const code = String(value).trim();
  return code.length <= MONNIFY_RESPONSE_CODE_MAX_LENGTH &&
    MONNIFY_RESPONSE_CODE_SHAPE.test(code)
    ? code
    : undefined;
}
