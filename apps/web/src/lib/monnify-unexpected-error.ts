/**
 * Monnify's code 99 means "unexpected error, re-query": the vend outcome is
 * unknown, so such an answer is never a refusal another provider may act on.
 * One code matcher for every place that reads it.
 */
const MONNIFY_UNEXPECTED_ERROR_CODE = /^0*99$/;

/** Whether a response code (string or number) is Monnify's code 99. */
export function isMonnifyUnexpectedErrorCode(code: unknown): boolean {
  if (typeof code !== 'string' && typeof code !== 'number') {
    return false;
  }
  return MONNIFY_UNEXPECTED_ERROR_CODE.test(String(code).trim());
}
