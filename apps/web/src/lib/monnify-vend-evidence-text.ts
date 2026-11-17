/**
 * A vend status or reference written as text (plain or form-encoded bodies),
 * e.g. "vendReference=MFBP-1" or "Transaction Reference: MFBP-1". Any key
 * casing, with "_", "-" or a space between the words.
 */
const MONNIFY_VEND_EVIDENCE_TEXT =
  /\b(?:vend[\s_-]*status|(?:transaction|vend|payment)[\s_-]*reference)["']?\s*[:=]\s*["']?[A-Za-z0-9][\w.-]*/i;

/** Whether raw (non-JSON) Monnify text names a vend status or reference. */
export function mentionsMonnifyVendEvidence(
  text: string | null | undefined
): boolean {
  return !!text && MONNIFY_VEND_EVIDENCE_TEXT.test(text);
}
