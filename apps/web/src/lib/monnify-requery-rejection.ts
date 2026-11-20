import { joinMonnifyAnswerStrings } from './monnify-answer-strings';
import { hasBodyToken } from './monnify-bills-status';
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
  /\b(?:vend|transaction|purchase|airtime|payment|top\s?up|recharge)\w*(?:\s+\w+){0,2}?\s+(?:failed|failure|unsuccessful|declined|reversed|cancell?ed|rejected|refused|denied)\b|\bfail(?:ed|ure)(?:\s+\w+){0,2}?\s+(?:vend|transaction|purchase|airtime|payment|top\s?up|recharge)|\bfailed\s+to\s+vend\b/i;

/**
 * A failure of an ancillary operation (reversal, refund, settlement...) says
 * nothing about whether the original vend completed.
 */
const ANCILLARY_OPERATION_WORDING =
  /\b(?:reversal|refund|chargeback|settlement|callback|webhook|notification)\w*(?:\s+\w+){0,2}?\s+(?:failed|failure|unsuccessful|declined|rejected|refused|denied|error)\b|\b(?:failed|failure|unable)\s+(?:to\s+)?(?:\w+\s+){0,2}?(?:reversal|refund|chargeback|settlement|callback|webhook|notification)|\b(?:failed|unable)\s+to\s+(?:reverse|settle|refund|notify|call\s?back|send)\b/i;

/** A negated or hedged failure ("has not failed", "was not unsuccessful") proves nothing. */
const NEGATED_FAILURE_WORDING =
  /\b(?:not|never|no|n't|cannot)\s+(?:\w+\s+)?(?:fail(?:ed|ure)?|unsuccessful|declined|reversed|cancell?ed|rejected|refused|denied)\b|\b(?:not|never|cannot|can't|couldn't|could\s+not)\s+(?:\w+\s+){0,2}?(?:confirm\w*|verif\w+|establish\w*)\b|\bun(?:confirmed|verified)\b|\b(?:may|might|possibly|probably|perhaps|presumably|likely|seems?|appears?|(?:could|would)\s+have)\b(?:\s+\w+){0,3}?\s+(?:fail\w*|unsuccessful|declined|reversed|cancell?ed|rejected|refused|denied)\b|\b(?:no|without|lack(?:s|ing)?)\s+(?:\w+\s+)?(?:evidence|proof|confirmation|indication)\b|\bunable\s+to\s+(?:establish|determine|confirm|verify|prove)\b|\b(?:not|cannot)\s+(?:be\s+)?(?:determined|established|proven|proved)\b|\b(?:possible|possibly|unlikely|uncertain|doubtful|unclear|questionable)\b/i;

/**
 * Wording about the requery itself rather than the vend: the reference is
 * unknown or invalid. Monnify's requery reports "not found" even for
 * delivered vends when asked with the wrong reference (#2784).
 */
const LOOKUP_WORDING =
  /\b(?:not\s+found|no\s+(?:record|transaction)|does\s+not\s+exist|doesn't\s+exist|(?:status|lookup|query|requery|enquiry|inquiry|retrieval|fetch|request|authentication|login|token|access)\s+(?:\w+\s+)?(?:failed|declined|rejected|refused|denied|unsuccessful|cancell?ed|reversed)|invalid\s+(?:\w+\s+)?ref(?:erence)?|unknown\s+(?:\w+\s+)?ref(?:erence)?)\b/i;

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
  // A vend-level FAILED status in the body is conclusive: it is not masked by
  // generic query wording such as "Request failed" in the message.
  // A voucher token in the body means the vend may have delivered.
  if (hasBodyToken(envelope)) {
    return false;
  }
  if (hasMonnifyExplicitVendFailure(envelope)) {
    return !isMonnifyUnresolvedAnswer({ answer: envelope, wording });
  }
  // Each guard qualifies only the clause it sits in: "Vend failed. Status
  // lookup failed" still proves the vend failed.
  const provesFailure = wording
    .split(/[.;\n]+/)
    .some(
      (clause) =>
        VEND_FAILED_WORDING.test(clause) &&
        !LOOKUP_WORDING.test(clause) &&
        !NEGATED_FAILURE_WORDING.test(clause) &&
        !ANCILLARY_OPERATION_WORDING.test(clause)
    );
  return (
    provesFailure && !isMonnifyUnresolvedAnswer({ answer: envelope, wording })
  );
}
