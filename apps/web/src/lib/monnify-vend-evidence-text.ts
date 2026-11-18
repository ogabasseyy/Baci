/**
 * A vend status or reference written as text (plain or form-encoded bodies,
 * or a message), in any key casing with "_", "-" or a space between words:
 * - after ":" or "=": "vendReference=MFBP-1", "Transaction Reference: MFBP-2",
 *   "transactionId=MFBP-4", or a bare "reference=MFBP-3";
 * - after a space only, when the value carries a digit (an id, not a word):
 *   "vendReference MFBP-1", "transaction reference MFBP-2".
 * A bare reference may be an echo of our own request reference; reading it
 * as evidence fails closed (refund, no Kuda), never a double vend.
 */
const KEY =
  '(?:(?:vend|transaction|txn|payment|order|purchase)[\\s_-]*status|(?:(?:transaction|vend|payment|order)[\\s_-]*)?ref(?:erence)?(?![A-Za-z])|(?:transaction|txn|vend|order|payment|purchase)[\\s_-]*(?:id|number|no)(?![A-Za-z])|(?:receipt|invoice)(?:[\\s_-]*(?:number|no|id))?)';
/**
 * A generic "status=FAILED" pair: any non-numeric value except HTTP reason
 * phrases and error labels ("error", "Bad Request"), like the JSON check.
 */
const GENERIC_STATUS =
  '\\b(?:[A-Za-z]+[\\s_-]?)?status["\']?\\s*[:=]\\s*["\']?(?!(?:errors?|ok|bad|payment[\\s_-]*required|unauthori[sz]ed|forbidden|not|conflict|unprocessable|too|internal|gateway|service|invalid|validation|method|request)(?![A-Za-z0-9]))[A-Za-z][\\w-]*';
const MONNIFY_VEND_EVIDENCE_TEXT = new RegExp(
  `${GENERIC_STATUS}|\\b${KEY}["']?\\s*[:=]\\s*["']?[A-Za-z0-9][\\w.-]*` +
    `|\\b${KEY}\\s+(?=[\\w.-]*\\d)[A-Za-z0-9][\\w.-]*`,
  'i'
);

/** Whether raw (non-JSON) Monnify text names a vend status or reference. */
export function mentionsMonnifyVendEvidence(
  text: string | null | undefined
): boolean {
  return !!text && MONNIFY_VEND_EVIDENCE_TEXT.test(text);
}
