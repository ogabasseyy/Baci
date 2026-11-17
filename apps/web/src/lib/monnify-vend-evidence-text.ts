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
  '(?:vend[\\s_-]*status|(?:(?:transaction|vend|payment|order)[\\s_-]*)?reference|(?:transaction|txn|vend|order)[\\s_-]*id)';
const MONNIFY_VEND_EVIDENCE_TEXT = new RegExp(
  `\\b${KEY}["']?\\s*[:=]\\s*["']?[A-Za-z0-9][\\w.-]*` +
    `|\\b${KEY}\\s+(?=[\\w.-]*\\d)[A-Za-z0-9][\\w.-]*`,
  'i'
);

/** Whether raw (non-JSON) Monnify text names a vend status or reference. */
export function mentionsMonnifyVendEvidence(
  text: string | null | undefined
): boolean {
  return !!text && MONNIFY_VEND_EVIDENCE_TEXT.test(text);
}
