/**
 * Wording that talks about what happened to a vend, or about the service
 * being unavailable: such an answer may come after a vend was handed to the
 * network (e.g. from a gateway), so it never counts as a pre-vend refusal,
 * whatever else it says. A vend still pending, processing, queued or in
 * progress counts too: it may yet complete. A negated outcome ("could not be processed",
 * "not delivered") says nothing happened, so it does not count.
 */
const MONNIFY_VEND_OUTCOME_PATTERN =
  /unavailable|\bunsuccessful|(?:vend|transaction|purchase|airtime|payment|top[\s-]?up|recharge)\w*(?:\s+\w+){0,2}?\s+fail|fail\w*\s+to\s+vend|(?<!(?:\bnot|\bnever|\bcannot|n't)\s+(?:be\s+|been\s+)?)\b(?:delivered|processed|completed|successful|vended|dispatched|pending|processing|queued|in\s+progress)\b/i;

/**
 * Whether a Monnify answer mentions a vend outcome or an unavailable service.
 * Machine-style wording ("transaction_failed", "vend-in-progress") is read
 * with its "_" and "-" separators turned into spaces as well. camelCase is
 * deliberately not split: envelope keys such as requestSuccessful would
 * then read as an outcome.
 */
export function isMonnifyVendOutcomeText(
  text: string | null | undefined
): boolean {
  if (!text) {
    return false;
  }
  return (
    MONNIFY_VEND_OUTCOME_PATTERN.test(text) ||
    MONNIFY_VEND_OUTCOME_PATTERN.test(text.replace(/[_-]+/g, ' '))
  );
}
