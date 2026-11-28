import type { PurchaseResult } from '@/lib/kuda';
import { joinMonnifyAnswerStrings } from './monnify-answer-strings';
import { mentionsMonnifyAuthWording } from './monnify-auth-wording';
import {
  type MonnifyHttpError,
  sanitizeMonnifyErrorDetail,
} from './monnify-bills-errors';
import { getMonnifyEnvelopeMessage } from './monnify-bills-shared';
import { hasBodyToken } from './monnify-bills-status';
import { isMonnifyDefiniteBusinessRefusal } from './monnify-business-refusal';
import { hasMonnifyAuthOrThrottleCode } from './monnify-non-definitive-code';
import { readMonnifyRejectionVendReference } from './monnify-rejection-vend-reference';
import { readMonnifyResponseCode } from './monnify-response-code';
import { isMonnifyUnresolvedAnswer } from './monnify-unresolved-answer';
import { buildMonnifyUnresolvedVendResult } from './monnify-unresolved-vend-result';

const HTTP_REJECTION_MESSAGE =
  'Monnify rejected the bill payment request. Please verify the details and try again.';

/**
 * An HTTP-200 envelope that is not a business success. A definite refusal
 * before any vend (low float, amount check) fails and may go to Kuda; an
 * answer that leaves the outcome open (pending, code 99, a duplicate, a
 * contradictory success code "0"...) is held; anything else fails and is
 * refunded, as before.
 */
export function buildMonnifyBusinessRejectionResult({
  amount,
  envelope,
  parsedEnvelope,
  requestReference,
}: {
  amount: number;
  envelope: unknown;
  parsedEnvelope: { responseCode: string; responseMessage?: string };
  requestReference: string;
}): PurchaseResult {
  const rawMessage = getMonnifyEnvelopeMessage({
    fallback: 'Monnify business failure',
    responseCode: parsedEnvelope.responseCode,
    responseMessage: parsedEnvelope.responseMessage,
  });
  // Scrubbed like HTTP error details: Monnify may echo the customer's
  // number, and this text is persisted and logged. Classification reads
  // the full answer, before it is cut short.
  const message = sanitizeMonnifyErrorDetail(rawMessage);
  const providerResponseCode = readMonnifyResponseCode(parsedEnvelope);
  // A real token beside refusal wording means a voucher may have been
  // delivered: never a definite refusal (no Kuda, no refund).
  const providerDefiniteFailure =
    !hasBodyToken(envelope) &&
    isMonnifyDefiniteBusinessRefusal({
      envelope,
      rawMessage,
      responseCode: parsedEnvelope.responseCode,
    });
  const contradictorySuccessCode = /^\s*0+\s*$/.test(
    parsedEnvelope.responseCode
  );
  // 401/403/429 as a business code is a login rejection or throttle: refunded
  // whatever the body shows (owner decision 2026-11-18), like the HTTP path.
  // A real voucher token dominates: refunding after a delivered voucher pays
  // twice, so a token still holds even beside a 401/403/429 code.
  const isAuthOrThrottleCode =
    (/^\s*0*(?:401|403|429)\s*$/.test(parsedEnvelope.responseCode) ||
      hasMonnifyAuthOrThrottleCode(envelope) ||
      // Authentication wording is refund-only whatever the code and body
      // (owner decision): "Invalid access token" with D01 and a PENDING echo.
      mentionsMonnifyAuthWording(
        `${rawMessage} ${joinMonnifyAnswerStrings(envelope)}`
      )) &&
    !hasBodyToken(envelope);
  if (
    !providerDefiniteFailure &&
    !isAuthOrThrottleCode &&
    ((contradictorySuccessCode &&
      // A login rejection is refunded whatever its code (owner decision).
      !mentionsMonnifyAuthWording(
        `${rawMessage} ${joinMonnifyAnswerStrings(envelope)}`
      )) ||
      hasBodyToken(envelope) ||
      isMonnifyUnresolvedAnswer({
        answer: envelope,
        requestReference,
        wording: `${rawMessage} ${joinMonnifyAnswerStrings(envelope)}`,
      }))
  ) {
    return buildMonnifyUnresolvedVendResult({
      amount,
      message,
      providerErrorDetail: message,
      providerResponseCode,
      providerTokenSeen: hasBodyToken(envelope),
      providerVendReference: readMonnifyRejectionVendReference(
        envelope,
        requestReference
      ),
      requestReference,
    });
  }
  return {
    success: false,
    reference: requestReference,
    message,
    status: 'failed',
    amount,
    providerDefiniteFailure,
    providerResponseCode,
  };
}

/**
 * A 4xx answer to the vend. A known refusal before any vend may go to Kuda;
 * an answer that leaves the outcome open is held (see
 * MonnifyHttpError.leavesOutcomeOpenFor); anything else, including 401/403
 * login rejections (owner decision 2026-11-18) and 429 throttles, fails and
 * is refunded, as before.
 */
export function buildMonnifyHttpRejectionResult({
  amount,
  error,
  requestReference,
}: {
  amount: number;
  error: MonnifyHttpError;
  requestReference: string;
}): PurchaseResult {
  // A refusal Monnify gave before vending: a known refusal (the amount
  // check, Baci's Monnify float too low). A 401/403 never qualifies
  // (owner decision): Monnify does not document that its auth check runs
  // before any vend, so a login rejection is refunded, not re-vended. A
  // timeout (408), a throttle (429) or anything that may be a duplicate
  // never qualifies. Any answer that talks about the service being
  // unavailable or a vend outcome, or whose body carries a vend status or
  // reference, may come after a vend that ran, so it never qualifies.
  const providerDefiniteFailure =
    // Only reachable for 4xx (isClientError at the caller); kept explicit so
    // a future refactor can never let a 5xx (unknown outcome) through.
    error.status < 500 &&
    error.status !== 401 &&
    error.status !== 403 &&
    error.status !== 408 &&
    error.status !== 429 &&
    !error.isDuplicateReference &&
    !error.reportsUnexpectedError &&
    !error.mentionsVendOutcome &&
    !error.showsVendEvidence &&
    !error.mentionsAuthWording &&
    !error.bodyHasToken &&
    error.isKnownRefusal;
  if (
    !providerDefiniteFailure &&
    error.leavesOutcomeOpenFor(requestReference)
  ) {
    return buildMonnifyUnresolvedVendResult({
      amount,
      message: HTTP_REJECTION_MESSAGE,
      providerErrorDetail: error.diagnosticMessage,
      providerResponseCode: error.responseCode,
      providerTokenSeen: error.bodyHasToken,
      providerVendReference: error.providerVendReference(requestReference),
      requestReference,
    });
  }
  return {
    success: false,
    reference: requestReference,
    message: HTTP_REJECTION_MESSAGE,
    providerErrorDetail: error.diagnosticMessage,
    providerResponseCode: error.responseCode,
    status: 'failed',
    amount,
    providerDefiniteFailure,
  };
}
