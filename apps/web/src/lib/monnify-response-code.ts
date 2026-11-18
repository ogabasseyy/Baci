/**
 * A Monnify response code is stored only when it is code-shaped: 1-4 digits
 * ("0", "99"), or up to 12 upper-case letters, digits, "_" or "-" that
 * start with a letter and hold 1-4 digits ("D02", "MP_001"). Textual codes
 * with no digit are stored only when known (`DUPLICATE_REFERENCE`). Anything
 * else is dropped so free text, a phone number (grouped or not), a name
 * (e.g. "JOHN_DOE") or a token can never be stored as a "code".
 */
const MONNIFY_RESPONSE_CODE_SHAPE =
  /^(?!(?:\D*\d){5})(?:\d{1,4}|(?=[A-Z0-9_-]*\d)[A-Z][A-Z0-9_-]{1,11})$/;
const KNOWN_MONNIFY_TEXT_CODES = new Set(['DUPLICATE_REFERENCE']);

/**
 * The top-level `responseCode` value. A form-encoded answer with nested
 * fields parses into an array of one-pair objects; there the code counts
 * only when exactly one entry carries it.
 */
function topLevelResponseCode(answer: unknown): unknown {
  if (Array.isArray(answer)) {
    const entries = answer.filter(
      (entry): entry is Record<string, unknown> =>
        !!entry &&
        typeof entry === 'object' &&
        !Array.isArray(entry) &&
        Object.hasOwn(entry, 'responseCode')
    );
    return entries.length === 1 ? entries[0].responseCode : undefined;
  }
  if (!answer || typeof answer !== 'object') {
    return undefined;
  }
  return (answer as Record<string, unknown>).responseCode;
}

/**
 * Monnify's own response code from an answer's top-level `responseCode`
 * (string or finite number), kept on failed rows so a refusal can be
 * diagnosed (for example, whether "Insufficient funds" came with code 99).
 */
export function readMonnifyResponseCode(answer: unknown): string | undefined {
  const value = topLevelResponseCode(answer);
  if (
    typeof value !== 'string' &&
    !(typeof value === 'number' && Number.isFinite(value))
  ) {
    return undefined;
  }
  const code = String(value).trim();
  return KNOWN_MONNIFY_TEXT_CODES.has(code) ||
    MONNIFY_RESPONSE_CODE_SHAPE.test(code)
    ? code
    : undefined;
}
