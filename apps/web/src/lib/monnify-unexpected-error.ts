/**
 * Monnify's code 99 means "unexpected error, re-query": the vend outcome is
 * unknown, so such an answer is never a refusal another provider may act on.
 * One matcher for every place that reads it.
 */
const MONNIFY_UNEXPECTED_ERROR_CODE = /^0*99$/;
const MONNIFY_UNEXPECTED_ERROR_TEXT = /code["'\s:=]*"?0*99(?!\d)/i;

/** Whether a response code (string or number) is Monnify's code 99. */
export function isMonnifyUnexpectedErrorCode(code: unknown): boolean {
  if (typeof code !== 'string' && typeof code !== 'number') {
    return false;
  }
  return MONNIFY_UNEXPECTED_ERROR_CODE.test(String(code).trim());
}

/**
 * Whether a raw Monnify answer reports code 99: read as JSON where it parses,
 * otherwise (or as well) from the text in any shape or key casing.
 */
export function reportsMonnifyUnexpectedError(
  text: string | null | undefined
): boolean {
  if (!text) {
    return false;
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (
      parsed &&
      typeof parsed === 'object' &&
      isMonnifyUnexpectedErrorCode(
        (parsed as Record<string, unknown>).responseCode
      )
    ) {
      return true;
    }
  } catch {
    // Not JSON: fall through to the text check.
  }
  return MONNIFY_UNEXPECTED_ERROR_TEXT.test(text);
}
