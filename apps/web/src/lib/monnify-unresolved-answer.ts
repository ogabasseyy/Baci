import { mentionsMonnifyAuthWording } from './monnify-auth-wording';
import { hasMonnifyDuplicateFlag } from './monnify-duplicate-flag';
import { isMonnifyDuplicateReferenceText } from './monnify-duplicate-reference';
import { hasMonnifyUnresolvedCode } from './monnify-non-definitive-code';
import { hasMonnifyProviderReference } from './monnify-rejection-vend-reference';
import {
  createStructuredOutcome,
  readStructuredOutcome,
  settleVendPrecedence,
} from './monnify-structured-outcome';
import { normaliseMonnifyWording } from './monnify-text-normalise';
import { reportsMonnifyUnresolvedCode } from './monnify-unexpected-error-text';
import { isMonnifyKnownVendRefusalText } from './monnify-vend-refusal';

/** Wording is cut before the regex runs, so provider text can't make it slow. */
const MAX_WORDING_LENGTH = 4000;

/**
 * The same states (and a timeout or a request to re-query) as wording. A
 * negated state ("not delivered", "could not be completed", "has not yet
 * been processed") and a check before the vend ("validation successful")
 * do not count.
 */
const IN_FLIGHT_WORDING =
  /(?<!\b(?:not|never|no|cannot|n't)(?:\s+\w+){0,3}?\s+)(?<!(?:validation|verification|lookup|login|authentication|customer)\s+(?:(?:was|is|were|has|have|been|being|also|now)\s+)*)\b(?:pending|processing|in\s+progress|queued|initiated|submitted|accepted|successful(?:ly)?|succeeded|success|delivered|completed|credited|vended|dispatched|timed?\s*out|re\s*quer(?:y|ied)|(?:service\s+)?(?:temporarily\s+)?unavailable|(?:(?:vend|transaction|purchase|payment|delivery)\s+)?(?:status|outcome|result|state)\s+(?:is\s+|was\s+)?(?:still\s+)?(?:unknown|unclear|uncertain|indeterminate|undetermined)|indeterminate|undetermined)\b/i;

/**
 * Whether a Monnify rejection leaves the vend's outcome open, so the
 * customer must not be refunded straight away (Monnify may still deliver).
 *
 * `answer` is the parsed body (or null), `wording` Monnify's own text (string
 * values only, never JSON keys). Strong signs hold the row whatever else the
 * answer says: a duplicate reference, a vend status or wording that says the
 * vend ran or is running. A response code alone (99, 2xx, 408, 409, 5xx)
 * holds it too, unless Monnify's wording is a known refusal before any vend
 * (low float, amount check), which keeps today's refund.
 */
export function isMonnifyUnresolvedAnswer({
  answer,
  requestReference,
  wording,
}: {
  answer: unknown;
  /** When given, a Monnify reference in the body (not an echo of ours) holds. */
  requestReference?: string;
  wording: string;
}): boolean {
  const outcome = createStructuredOutcome();
  readStructuredOutcome(answer, outcome);
  settleVendPrecedence(outcome);
  // A running vend holds whatever else the body says. A done state (payment
  // taken, delivered) holds unless the same body names an explicit failure,
  // like classifyMonnifyBillStatus (FAILED beats a payment-level SUCCESS).
  // With an explicit failure and nothing running, the structure wins over
  // wording that only echoes the success state.
  const structuredHold =
    outcome.running ||
    outcome.incomplete ||
    // An unrecognised vend state proves nothing, even beside a FAILED one.
    outcome.unknown ||
    (outcome.done && !outcome.failed);
  const wordingHolds =
    !(outcome.failed && !outcome.running) &&
    IN_FLIGHT_WORDING.test(
      normaliseMonnifyWording(wording.slice(0, MAX_WORDING_LENGTH))
    );
  const strong =
    hasMonnifyDuplicateFlag(answer) ||
    isMonnifyDuplicateReferenceText(wording) ||
    structuredHold ||
    // A Monnify-issued reference in the body means a vend may exist.
    (requestReference !== undefined &&
      hasMonnifyProviderReference(answer, requestReference)) ||
    wordingHolds;
  if (strong) {
    return true;
  }
  const codeLeavesOutcomeOpen =
    hasMonnifyUnresolvedCode(answer) || reportsMonnifyUnresolvedCode(wording);
  // A login rejection with an open code is still refunded (owner decision
  // 2026-11-18), like a known refusal.
  return (
    codeLeavesOutcomeOpen &&
    !isMonnifyKnownVendRefusalText(wording) &&
    !mentionsMonnifyAuthWording(wording)
  );
}

/**
 * Whether a parsed Monnify answer names the vend itself as failed (FAILED
 * status or failed: true) with nothing still running or unrecognised: proof
 * of failure for a rejected requery whose message does not say so.
 */
export function hasMonnifyExplicitVendFailure(answer: unknown): boolean {
  const outcome = createStructuredOutcome();
  readStructuredOutcome(answer, outcome);
  settleVendPrecedence(outcome);
  // Only a VEND-level failure proves it: a generic top-level `status: FAILED`
  // may describe the lookup request itself.
  return (
    outcome.vendFailed &&
    !outcome.vendDone &&
    !outcome.running &&
    !outcome.unknown &&
    !outcome.incomplete
  );
}

/**
 * Whether a parsed Monnify answer names the vend as delivered/completed
 * (SUCCESS, COMPLETED...) or still running (PENDING...), even beside other states: a retry after such an
 * answer could pay the vend twice.
 */
export function hasMonnifyDeliveredVendStatus(answer: unknown): boolean {
  const outcome = createStructuredOutcome();
  readStructuredOutcome(answer, outcome);
  settleVendPrecedence(outcome);
  // A running vend (PENDING...) may still deliver, so it is never retried.
  return (
    outcome.running ||
    // A vend state Monnify did not name (UNKNOWN...) proves nothing: no retry.
    outcome.unknown ||
    outcome.vendDone ||
    (outcome.done && !outcome.vendFailed)
  );
}
