/**
 * A Monnify response code is code-shaped, with no lower-case letters and at
 * most 4 digits in all: 1-4 digits ("0", "99"), a short upper-case code
 * with at least one letter (up to 12 characters, e.g. "D02", "MP_001"), or
 * an upper-case snake-case name up to 40 characters (e.g.
 * "DUPLICATE_REFERENCE"). Anything else is dropped so free text, a phone
 * number (grouped or not), a name or a mixed-case token can never be
 * stored as a "code".
 */
const MONNIFY_RESPONSE_CODE_SHAPE =
  /^(?!(?:\D*\d){5})(?:\d{1,4}|(?=[A-Z0-9_-]*[A-Z])[A-Z0-9_-]{1,12}|[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)$/;
const MONNIFY_RESPONSE_CODE_MAX_LENGTH = 40;

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
  return code.length <= MONNIFY_RESPONSE_CODE_MAX_LENGTH &&
    MONNIFY_RESPONSE_CODE_SHAPE.test(code)
    ? code
    : undefined;
}
