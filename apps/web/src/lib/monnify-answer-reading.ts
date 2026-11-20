import { parseMonnifyAnswer } from './monnify-answer-parse';
import { joinMonnifyAnswerStrings } from './monnify-answer-strings';
import { mentionsMonnifyAuthWording } from './monnify-auth-wording';
import { hasBodyToken } from './monnify-bills-status';
import { hasMonnifyDuplicateFlag } from './monnify-duplicate-flag';
import { isMonnifyDuplicateReferenceText } from './monnify-duplicate-reference';
import {
  hasMonnifyAuthOrThrottleCode,
  hasMonnifyNonDefinitiveCode,
} from './monnify-non-definitive-code';
import {
  collectMonnifyProviderReferences,
  findMonnifyBodyVendReference,
} from './monnify-rejection-vend-reference';
import { readMonnifyResponseCode } from './monnify-response-code';
import { reportsMonnifyUnexpectedError } from './monnify-unexpected-error-text';
import {
  hasMonnifyDeliveredVendStatus,
  hasMonnifyExplicitVendFailure,
  isMonnifyUnresolvedAnswer,
} from './monnify-unresolved-answer';
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
  /** The body is an explicit vend-level failure with nothing open (a requery proof). */
  provesVendFailure: boolean;
  /** A 401/403/429 code anywhere in the body. */
  authOrThrottleCode: boolean;
  /** The body carries a real (non-placeholder) voucher token. */
  bodyHasToken: boolean;
  /** The body names the vend delivered (SUCCESS/COMPLETED...). */
  showsDeliveredStatus: boolean;
  /** The body leaves the vend's outcome open (see isMonnifyUnresolvedAnswer). */
  leavesOutcomeOpen: boolean;
  /** References Monnify put in responseBody (checked against the request later). */
  providerReferences: string[];
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
      // A body that parses is matched on its string VALUES only (raw JSON text
      // would read a catalog `product.code` as a response code); its codes are
      // read structurally below. Plain text is matched as is.
      reportsMonnifyUnexpectedError(parsed ? bodyText : body) ||
      hasMonnifyNonDefinitiveCode(parsed),
    showsVendEvidence: showsVendEvidence(body),
    // Auth wording counts from the HTTP reason phrase too (a proxy may move
    // "Unauthorized" there while keeping a 400 status).
    mentionsAuthWording: mentionsMonnifyAuthWording(text),
    responseCode: readMonnifyResponseCode(parsed),
    provesVendFailure:
      !hasBodyToken(parsed) &&
      hasMonnifyExplicitVendFailure(parsed) &&
      !isMonnifyUnresolvedAnswer({ answer: parsed, wording: text }),
    authOrThrottleCode: hasMonnifyAuthOrThrottleCode(parsed),
    bodyHasToken: hasBodyToken(parsed),
    showsDeliveredStatus: hasMonnifyDeliveredVendStatus(parsed),
    leavesOutcomeOpen:
      hasBodyToken(parsed) ||
      isMonnifyUnresolvedAnswer({
        answer: parsed,
        // The reason phrase counts too ("Vend in progress" with an empty body).
        wording: text,
      }),
    providerReferences: collectMonnifyProviderReferences(parsed),
    vendReferenceCandidate: findMonnifyBodyVendReference(parsed),
  };
}
