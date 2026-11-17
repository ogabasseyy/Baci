/**
 * Wording that talks about what happened to a vend, or about the service
 * being unavailable: such an answer may come after a vend was handed to the
 * network (e.g. from a gateway), so it never counts as a pre-vend refusal,
 * whatever else it says.
 */
const MONNIFY_VEND_OUTCOME_PATTERN =
  /unavailable|vend\w*\s+(?:request\s+)?fail|fail\w*\s+to\s+vend|\b(?:delivered|processed|completed|successful|vended|dispatched)\b/i;

/** Whether a Monnify answer mentions a vend outcome or an unavailable service. */
export function isMonnifyVendOutcomeText(
  text: string | null | undefined
): boolean {
  return !!text && MONNIFY_VEND_OUTCOME_PATTERN.test(text);
}
