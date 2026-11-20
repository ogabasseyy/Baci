import { hasMonnifyDuplicateFlag } from './monnify-duplicate-flag';
import { isMonnifyDuplicateReferenceText } from './monnify-duplicate-reference';
import { hasMonnifyUnresolvedCode } from './monnify-non-definitive-code';
import { normaliseMonnifyWording } from './monnify-text-normalise';
import { reportsMonnifyUnresolvedCode } from './monnify-unexpected-error-text';
import { isMonnifyKnownVendRefusalText } from './monnify-vend-refusal';

const MAX_DEPTH = 6;

/** Vend states that say the vend is still running: Monnify may yet deliver. */
const RUNNING_STATUSES = new Set([
  'ACCEPTED',
  'INITIATED',
  'INPROGRESS',
  'PENDING',
  'PROCESSING',
  'QUEUED',
  'SUBMITTED',
]);
/** States that say the vend ran (or the payment was taken). */
const DONE_STATUSES = new Set(['COMPLETED', 'PAID', 'SUCCESS', 'SUCCESSFUL']);
/** Explicit failure: the same names classifyMonnifyBillStatus treats as failed. */
const FAILED_STATUSES = new Set(['FAILED', 'FAILURE', 'UNSUCCESSFUL']);

/**
 * The same states (and a timeout or a request to re-query) as wording. A
 * negated state ("not delivered", "could not be completed", "has not yet
 * been processed") and a check before the vend ("validation successful")
 * do not count.
 */
const IN_FLIGHT_WORDING =
  /(?<!\b(?:not|never|no|cannot|n't)(?:\s+\w+){0,3}?\s+)(?<!(?:validation|verification|lookup|login|authentication|customer)\s+)\b(?:pending|processing|in\s+progress|queued|initiated|submitted|accepted|successful(?:ly)?|succeeded|success|delivered|completed|credited|vended|dispatched|timed?\s*out|re\s*quer(?:y|ied))\b/i;

/** Every string value under a key ending in "status", normalised, at any depth. */
function collectStatuses(answer: unknown, found: string[], depth = 0): boolean {
  if (!answer || typeof answer !== 'object') {
    return true;
  }
  // Nesting deeper than we scan can't be cleared: fail closed (hold).
  if (depth > MAX_DEPTH) {
    return false;
  }
  const children = Array.isArray(answer)
    ? answer.map((item) => ['', item] as const)
    : Object.entries(answer);
  let complete = true;
  for (const [key, value] of children) {
    if (
      key
        .replace(/[\s_-]/g, '')
        .toLowerCase()
        .endsWith('status') &&
      typeof value === 'string'
    ) {
      found.push(value.replace(/[\s_-]/g, '').toUpperCase());
    }
    if (!collectStatuses(value, found, depth + 1)) {
      complete = false;
    }
  }
  return complete;
}

/**
 * Holds on a vend that is running anywhere in the body, and on a done state
 * (payment taken, vend completed) unless the same body also names an explicit
 * failure: like classifyMonnifyBillStatus, a FAILED vend status beats a
 * payment-level SUCCESS/PAID, so a failed vend is refunded, not stranded.
 */
function hasInFlightStatus(answer: unknown): boolean {
  const statuses: string[] = [];
  if (!collectStatuses(answer, statuses)) {
    return true;
  }
  if (statuses.some((status) => RUNNING_STATUSES.has(status))) {
    return true;
  }
  return (
    statuses.some((status) => DONE_STATUSES.has(status)) &&
    !statuses.some((status) => FAILED_STATUSES.has(status))
  );
}

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
  wording,
}: {
  answer: unknown;
  wording: string;
}): boolean {
  const strong =
    hasMonnifyDuplicateFlag(answer) ||
    isMonnifyDuplicateReferenceText(wording) ||
    hasInFlightStatus(answer) ||
    IN_FLIGHT_WORDING.test(normaliseMonnifyWording(wording));
  if (strong) {
    return true;
  }
  const codeLeavesOutcomeOpen =
    hasMonnifyUnresolvedCode(answer) || reportsMonnifyUnresolvedCode(wording);
  return codeLeavesOutcomeOpen && !isMonnifyKnownVendRefusalText(wording);
}
