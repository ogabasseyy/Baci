import { isMonnifyUnexpectedErrorCode } from './monnify-unexpected-error';

/**
 * "Code 99" on its own, or a response/error/result/status code key set to
 * 99, 408, 409 or 429 (unknown outcome, timeout, conflict, throttle), so
 * plain-text and form-encoded bodies ("responseCode=408", "status=408")
 * are read too. A product/biller/item/service code ("product code is 99")
 * never counts.
 * Other keys that end in "code" (productCode, product_code, biller-code)
 * never count.
 */
/**
 * "code" / "status code" key shapes followed by a value; the numeric part is
 * appended per pattern below as a hard-coded literal (no RegExp built from a
 * variable, so there is nothing to ReDoS-audit at runtime).
 */
const MONNIFY_UNEXPECTED_ERROR_TEXT =
  /(?<![A-Za-z_-])(?<!\b(?:product|biller|item|service|customer|package|plan)\s+)(?:(?:(?:response|error|result|status)[\s_-]*)?code|(?:(?:http|response|result)[\s_-]*)?status(?:[\s_-]*code)?)["'\s:=]*(?:(?:is|was)\s*[:=]?\s*)?\[?\s*"?0*(?:99|2\d\d|401|403|408|409|429|5\d\d)(?!\d)/i;
/**
 * The same shapes, for the codes that leave a vend's outcome open (99, 2xx,
 * 408, 409, 5xx); 401/403/429 are refusals before any vend.
 */
const MONNIFY_UNRESOLVED_CODE_TEXT =
  /(?<![A-Za-z_-])(?<!\b(?:product|biller|item|service|customer|package|plan)\s+)(?:(?:(?:response|error|result|status)[\s_-]*)?code|(?:(?:http|response|result)[\s_-]*)?status(?:[\s_-]*code)?)["'\s:=]*(?:(?:is|was)\s*[:=]?\s*)?\[?\s*"?(?:0+|0*(?:99|2\d\d|408|409|5\d\d))(?!\d)/i;

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

/**
 * Whether a raw Monnify answer (JSON or text) carries a response code that
 * leaves the vend's outcome open: 99, 2xx, 408, 409 or 5xx.
 */
export function reportsMonnifyUnresolvedCode(
  text: string | null | undefined
): boolean {
  return !!text && MONNIFY_UNRESOLVED_CODE_TEXT.test(text);
}
