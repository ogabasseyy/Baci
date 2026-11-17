/**
 * Wording that talks about what happened to a vend, or about the service
 * being unavailable: such an answer may come after a vend was handed to the
 * network (e.g. from a gateway), so it never counts as a pre-vend refusal,
 * whatever else it says. A vend still pending, processing, queued or in
 * progress counts too: it may yet complete, and so do initiated and
 * reversed vends (the same states the structured status check reads). A negated outcome ("could not be processed",
 * "not delivered", "not yet delivered", "could not have been processed",
 * up to three words after the negator) says nothing happened, so it does
 * not count.
 */
const MONNIFY_VEND_OUTCOME_PATTERN =
  /unavailable|\bunsuccessful|\btime[ds]?\s*out\b|(?:vend|transaction|purchase|airtime|payment|top[\s-]?up|recharge)\w*(?:\s+\w+){0,2}?\s+fail|fail\w*\s+to\s+vend|(?:vend|transaction|purchase|airtime|payment|top\s?up|recharge)\w*(?:\s+\w+){0,3}?\s+(?:submitted|accepted)\b|\bfail(?:ed|ure)(?:\s+\w+){0,2}?\s+(?:vend|transaction|purchase|airtime|payment|top\s?up|recharge)|(?<!(?:\bnot|\bnever|\bcannot|\bno|n't)(?:\s+\w+){0,3}?\s+)(?<!(?:validation|verification|lookup|login|authentication|customer)\s+)\b(?:delivered|processed|completed|successful|vended|dispatched|pending|processing|queued|in\s+progress|initiated|reversed)\b/i;

/**
 * Whether a Monnify answer mentions a vend outcome or an unavailable service.
 * Text is read with "_" and "-" turned into spaces, so machine-style
 * wording ("transaction_failed", "vend-in-progress") matches and hyphenated
 * negations ("not-delivered") stay negated. A timeout ("timed out") is an
 * unknown outcome and counts too. camelCase is
 * deliberately not split: envelope keys such as requestSuccessful would
 * then read as an outcome.
 */
export function isMonnifyVendOutcomeText(
  text: string | null | undefined
): boolean {
  if (!text) {
    return false;
  }
  // One match on the normalised text only, so a hyphenated negation
  // ("not-delivered") is read as negated, not as a bare "delivered".
  return MONNIFY_VEND_OUTCOME_PATTERN.test(text.replace(/[_-]+/g, ' '));
}
