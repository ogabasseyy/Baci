import { joinMonnifyAnswerStrings } from './monnify-answer-strings';
import { normaliseMonnifyWording } from './monnify-text-normalise';
import { isMonnifyUnresolvedAnswer } from './monnify-unresolved-answer';

/** Wording that names the vend itself as failed. */
const VEND_FAILED_WORDING =
  /\b(?:fail(?:ed|ure)?|unsuccessful|declined|reversed|cancell?ed)\b/i;

/**
 * Wording about the requery itself rather than the vend: the reference is
 * unknown or invalid. Monnify's requery reports "not found" even for
 * delivered vends when asked with the wrong reference (#2784).
 */
const LOOKUP_WORDING =
  /\b(?:not\s+found|no\s+(?:record|transaction)|does\s+not\s+exist|doesn't\s+exist|invalid\s+(?:\w+\s+)?ref(?:erence)?|unknown\s+(?:\w+\s+)?ref(?:erence)?)\b/i;

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
    VEND_FAILED_WORDING.test(wording) &&
    !LOOKUP_WORDING.test(wording) &&
    !isMonnifyUnresolvedAnswer({ answer: envelope, wording })
  );
}
