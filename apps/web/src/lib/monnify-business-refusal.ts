import { joinMonnifyAnswerStrings } from './monnify-answer-strings';
import { mentionsMonnifyAuthWording } from './monnify-auth-wording';
import { hasMonnifyDuplicateFlag } from './monnify-duplicate-flag';
import { isMonnifyDuplicateReferenceText } from './monnify-duplicate-reference';
import { hasMonnifyNonDefinitiveCode } from './monnify-non-definitive-code';
import { isMonnifyUnexpectedErrorCode } from './monnify-unexpected-error';
import { reportsMonnifyUnresolvedCode } from './monnify-unexpected-error-text';
import { hasMonnifyVendEvidence } from './monnify-vend-evidence';
import { mentionsMonnifyVendEvidence } from './monnify-vend-evidence-text';
import { isMonnifyVendOutcomeText } from './monnify-vend-outcome';
import { isMonnifyKnownVendRefusalText } from './monnify-vend-refusal';

/**
 * Whether a Monnify business rejection (an HTTP-200 envelope that is not a
 * success) is a definite pre-vend refusal that another provider may vend.
 *
 * Wording checks read the message and the envelope's string values, never
 * its JSON keys (a key such as `processed: false` or
 * `insufficient_wallet_balance: false` says nothing). Structured checks read
 * fields by value at any depth: code 99/408/409/429, a vend status or
 * reference, or a set duplicate flag all rule a refusal out.
 */

export function isMonnifyDefiniteBusinessRefusal({
  envelope,
  rawMessage,
  responseCode,
}: {
  envelope: unknown;
  rawMessage: string;
  responseCode: string | null | undefined;
}): boolean {
  const wording = `${rawMessage} ${joinMonnifyAnswerStrings(envelope)}`;
  return (
    !isMonnifyUnexpectedErrorCode(responseCode) &&
    // Monnify's success code "0" on a rejected envelope is contradictory, so
    // the outcome is ambiguous: never a definite refusal.
    !/^\s*0+\s*$/.test(responseCode ?? '') &&
    !hasMonnifyNonDefinitiveCode(envelope) &&
    // A code written into the message ("response code 99") leaves it open too.
    !reportsMonnifyUnresolvedCode(wording) &&
    !hasMonnifyVendEvidence(envelope) &&
    !mentionsMonnifyVendEvidence(joinMonnifyAnswerStrings(envelope)) &&
    !hasMonnifyDuplicateFlag(envelope) &&
    !isMonnifyDuplicateReferenceText(wording) &&
    !isMonnifyVendOutcomeText(wording) &&
    !mentionsMonnifyAuthWording(wording) &&
    isMonnifyKnownVendRefusalText(wording)
  );
}
