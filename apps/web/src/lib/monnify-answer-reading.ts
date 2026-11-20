import { parseMonnifyAnswer } from './monnify-answer-parse';
import { joinMonnifyAnswerStrings } from './monnify-answer-strings';
import { mentionsMonnifyAuthWording } from './monnify-auth-wording';
import { hasMonnifyDuplicateFlag } from './monnify-duplicate-flag';
import { isMonnifyDuplicateReferenceText } from './monnify-duplicate-reference';
import { hasMonnifyNonDefinitiveCode } from './monnify-non-definitive-code';
import { findMonnifyBodyVendReference } from './monnify-rejection-vend-reference';
import { readMonnifyResponseCode } from './monnify-response-code';
import { reportsMonnifyUnexpectedError } from './monnify-unexpected-error-text';
import { isMonnifyUnresolvedAnswer } from './monnify-unresolved-answer';
import { hasMonnifyVendEvidence } from './monnify-vend-evidence';
import { mentionsMonnifyVendEvidence } from './monnify-vend-evidence-text';
import { isMonnifyVendOutcomeText } from './monnify-vend-outcome';
import { isMonnifyKnownVendRefusalText } from './monnify-vend-refusal';

/** How Monnify's full answer reads, worked out once from the unscrubbed text. */
export interface MonnifyAnswerReading {
  isDuplicateReference: boolean;
  isKnownRefusal: boolean;
  mentionsVendOutcome: boolean;
  reportsUnexpectedError: boolean;
  showsVendEvidence: boolean;
  mentionsAuthWording: boolean;
  responseCode: string | undefined;
  /** The body leaves the vend's outcome open (see isMonnifyUnresolvedAnswer). */
  leavesOutcomeOpen: boolean;
  /** Monnify's own responseBody.vendReference, if the answer carries one. */
  vendReferenceCandidate: string | undefined;
}

/**
 * A JSON or key=value body is read structurally, plus the text of its string
 * values (not its keys, so a top-level reference echo does not count).
 * Anything else is read as plain text.
 */
function showsVendEvidence(body: string): boolean {
  const parsed = parseMonnifyAnswer(body);
  if (parsed && typeof parsed === 'object') {
    return (
      hasMonnifyVendEvidence(parsed) ||
      mentionsMonnifyVendEvidence(joinMonnifyAnswerStrings(parsed))
    );
  }
  return mentionsMonnifyVendEvidence(body);
}

/**
 * `statusLine` is the error's status line; `body` is Monnify's answer alone.
 */
export function readMonnifyAnswer(
  statusLine: string,
  body: string
): MonnifyAnswerReading {
  // A JSON body is read by its string values (not its keys) for wording.
  const parsed = parseMonnifyAnswer(body);
  const bodyText =
    parsed && typeof parsed === 'object'
      ? joinMonnifyAnswerStrings(parsed)
      : body;
  const text = `${statusLine} - ${bodyText}`;
  return {
    // Duplicate wording is read from values; a structured flag counts only
    // when set (`duplicate: true`, not `duplicate: false`).
    isDuplicateReference:
      isMonnifyDuplicateReferenceText(text) || hasMonnifyDuplicateFlag(parsed),
    // A refusal must come from Monnify's body, never the HTTP status line.
    isKnownRefusal: isMonnifyKnownVendRefusalText(bodyText),
    mentionsVendOutcome: isMonnifyVendOutcomeText(text),
    reportsUnexpectedError:
      reportsMonnifyUnexpectedError(body) ||
      hasMonnifyNonDefinitiveCode(parsed),
    showsVendEvidence: showsVendEvidence(body),
    // Auth wording counts from the HTTP reason phrase too (a proxy may move
    // "Unauthorized" there while keeping a 400 status).
    mentionsAuthWording: mentionsMonnifyAuthWording(text),
    responseCode: readMonnifyResponseCode(parsed),
    leavesOutcomeOpen: isMonnifyUnresolvedAnswer({
      answer: parsed,
      // The reason phrase counts too ("Vend in progress" with an empty body).
      wording: text,
    }),
    vendReferenceCandidate: findMonnifyBodyVendReference(parsed),
  };
}
