import { hasMonnifyDuplicateFlag } from './monnify-duplicate-flag';
import { isMonnifyDuplicateReferenceText } from './monnify-duplicate-reference';
import { hasMonnifyUnresolvedCode } from './monnify-non-definitive-code';
import { normaliseMonnifyWording } from './monnify-text-normalise';
import { reportsMonnifyUnresolvedCode } from './monnify-unexpected-error-text';
import { isMonnifyKnownVendRefusalText } from './monnify-vend-refusal';

const MAX_DEPTH = 6;

/**
 * Vend states that say the vend ran or is still running: Monnify may yet
 * deliver (or already has), so a refund now could pay the customer twice.
 */
const IN_FLIGHT_STATUSES = new Set([
  'ACCEPTED',
  'COMPLETED',
  'INITIATED',
  'INPROGRESS',
  'PAID',
  'PENDING',
  'PROCESSING',
  'QUEUED',
  'SUBMITTED',
  'SUCCESS',
  'SUCCESSFUL',
]);

/**
 * The same states (and a timeout or a request to re-query) as wording. A
 * negated state ("not delivered", "could not be completed", "has not yet
 * been processed") and a check before the vend ("validation successful")
 * do not count.
 */
const IN_FLIGHT_WORDING =
  /(?<!\b(?:not|never|no|cannot|n't)(?:\s+\w+){0,3}?\s+)(?<!(?:validation|verification|lookup|login|authentication|customer)\s+)\b(?:pending|processing|in\s+progress|queued|initiated|submitted|accepted|successful(?:ly)?|succeeded|success|delivered|completed|credited|vended|dispatched|timed?\s*out|re\s*quer(?:y|ied))\b/i;

function hasInFlightStatus(answer: unknown, depth = 0): boolean {
  if (!answer || typeof answer !== 'object') {
    return false;
  }
  // Nesting deeper than we scan can't be cleared: fail closed (hold).
  if (depth > MAX_DEPTH) {
    return true;
  }
  if (Array.isArray(answer)) {
    return answer.some((item) => hasInFlightStatus(item, depth + 1));
  }
  return Object.entries(answer).some(([key, value]) => {
    const isStatusKey = key
      .replace(/[\s_-]/g, '')
      .toLowerCase()
      .endsWith('status');
    return (
      (isStatusKey &&
        typeof value === 'string' &&
        IN_FLIGHT_STATUSES.has(value.replace(/[\s_-]/g, '').toUpperCase())) ||
      hasInFlightStatus(value, depth + 1)
    );
  });
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
