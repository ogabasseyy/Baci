import { joinMonnifyAnswerStrings } from './monnify-answer-strings';
import { normaliseMonnifyWording } from './monnify-text-normalise';
import {
  hasMonnifyExplicitVendFailure,
  isMonnifyUnresolvedAnswer,
} from './monnify-unresolved-answer';

/**
 * Wording that names the VEND itself as failed: a vend noun near a failure
 * word, "failed to vend", (no bare "declined"/"reversed": those can describe the query).
 * A bare "failed" ("Request failed", "Status lookup failed", "Authentication
 * failed") describes the query, not the vend, so it does not count.
 */
const VEND_FAILED_WORDING =
  /\b(?:vend|transaction|purchase|airtime|payment|top\s?up|recharge)\w*(?:\s+\w+){0,2}?\s+(?:failed|failure|unsuccessful|declined|reversed|cancell?ed)\b|\bfail(?:ed|ure)(?:\s+\w+){0,2}?\s+(?:vend|transaction|purchase|airtime|payment|top\s?up|recharge)|\bfailed\s+to\s+vend\b/i;

/** A negated failure ("has not failed", "was not unsuccessful") proves nothing. */
const NEGATED_FAILURE_WORDING =
  /\b(?:not|never|no|n't|cannot)\s+(?:\w+\s+)?(?:fail(?:ed|ure)?|unsuccessful|declined|reversed|cancell?ed)\b/i;

/**
 * Wording about the requery itself rather than the vend: the reference is
 * unknown or invalid. Monnify's requery reports "not found" even for
 * delivered vends when asked with the wrong reference (#2784).
 */
const LOOKUP_WORDING =
  /\b(?:not\s+found|no\s+(?:record|transaction)|does\s+not\s+exist|doesn't\s+exist|(?:status|lookup|query|requery|request|authentication|login|token|access)\s+(?:\w+\s+)?(?:failed|declined|rejected|refused|denied|unsuccessful|cancell?ed|reversed)|invalid\s+(?:\w+\s+)?ref(?:erence)?|unknown\s+(?:\w+\s+)?ref(?:erence)?)\b/i;

/**
 * Whether a requery that Monnify answered with a business rejection (not a
 * vend status) proves the vend failed. Only explicit failure wording counts,
 * and never when the answer also leaves the outcome open (code 99, pending,
 * a duplicate...) or is about the lookup (not found, invalid reference).
 * Anything else is not proof: the row stays `processing` and is never
 * refunded on it.
 */
export function isMonnifyRequeryRejectionDefiniteFailure({
  envelope,
  rawMessage,
}: {
  envelope: unknown;
  rawMessage: string;
}): boolean {
  const wording = normaliseMonnifyWording(
    `${rawMessage} ${joinMonnifyAnswerStrings(envelope)}`
  );
  return (
    (VEND_FAILED_WORDING.test(wording) ||
      hasMonnifyExplicitVendFailure(envelope)) &&
    !LOOKUP_WORDING.test(wording) &&
    !NEGATED_FAILURE_WORDING.test(wording) &&
    !isMonnifyUnresolvedAnswer({ answer: envelope, wording })
  );
}
