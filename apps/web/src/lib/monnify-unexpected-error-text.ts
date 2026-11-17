import { isMonnifyUnexpectedErrorCode } from './monnify-unexpected-error';

/**
 * "Code 99" on its own, or a response/error/result/status code key set to 99.
 * Other keys that end in "code" (productCode, product_code, biller-code)
 * never count.
 */
const MONNIFY_UNEXPECTED_ERROR_TEXT =
  /(?<![A-Za-z_-])(?:(?:response|error|result|status)[\s_-]*)?code["'\s:=]*(?:(?:is|was)\s*[:=]?\s*)?"?0*99(?!\d)/i;

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
