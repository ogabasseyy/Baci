import {
  monnifyEnvelopeSchema,
  requeryResponseBodySchema,
} from '@/schemas/monnify-bills-schema';
import { joinMonnifyAnswerStrings } from './monnify-answer-strings';
import { mentionsMonnifyAuthWording } from './monnify-auth-wording';
import { MonnifyHttpError } from './monnify-bills-errors';
import { monnifyRequest } from './monnify-bills-request';
import {
  getMonnifyEnvelopeMessage,
  isMonnifyBusinessSuccess,
  MONNIFY_FINANCIAL_TIMEOUT_MS,
} from './monnify-bills-shared';
import {
  classifyMonnifyBillStatus,
  hasConflictingVendStatuses,
  readMonnifyBillToken,
  toBillStatusInput,
} from './monnify-bills-status';
import { hasMonnifyAuthOrThrottleCode } from './monnify-non-definitive-code';
import { isMonnifyRequeryRejectionDefiniteFailure } from './monnify-requery-rejection';
import { readMonnifyResponseCode } from './monnify-response-code';

export async function checkTransactionStatus(
  transactionReference: string
): Promise<{
  /** 'successful' | 'processing' | 'failed' | 'unknown' ('unknown' proves nothing: never refund on it). */
  status: string;
  message: string;
  pin?: string;
  responseCode?: string;
  units?: string;
}> {
  let envelope: unknown;
  try {
    envelope = await monnifyRequest(
      `/api/v1/vas/bills-payment/requery?reference=${encodeURIComponent(transactionReference)}`,
      { method: 'GET', timeoutMs: MONNIFY_FINANCIAL_TIMEOUT_MS }
    );
  } catch (error) {
    // A 4xx whose body names the vend as FAILED (nothing open, no token) is
    // proof of failure, like the same body in an HTTP-200 rejection. Anything
    // else (auth, throttle, 5xx, unclear) is rethrown and the row stays put.
    if (
      error instanceof MonnifyHttpError &&
      error.isClientError &&
      ![401, 403, 429, 408, 409].includes(error.status) &&
      !error.isDuplicateReference &&
      // The same codes or authentication wording inside an HTTP 400 body are
      // login rejections/throttles: they prove nothing about the vend.
      !/^0*(?:401|403|429)$/.test(error.responseCode ?? '') &&
      !error.authOrThrottleCode &&
      !error.mentionsAuthWording &&
      error.provesVendFailure
    ) {
      return {
        status: 'failed',
        responseCode: error.responseCode,
        message: error.diagnosticMessage,
      };
    }
    throw error;
  }
  const parsed = monnifyEnvelopeSchema(requeryResponseBodySchema).parse(
    envelope
  );

  const message = getMonnifyEnvelopeMessage({
    fallback: 'failed',
    responseCode: parsed.responseCode,
    responseMessage: parsed.responseMessage,
  });
  const responseCode = readMonnifyResponseCode(parsed);

  if (isMonnifyBusinessSuccess(parsed)) {
    const body = parsed.responseBody;
    if (body && hasConflictingVendStatuses(body)) {
      return { status: 'unknown', responseCode, message };
    }
    const classified = body
      ? classifyMonnifyBillStatus(toBillStatusInput(body))
      : { isSuccess: false, isProcessing: false, isFailed: false };
    const { isProcessing, isFailed } = classified;
    // A returned token is conclusive even with a missing or unrecognised
    // status, like on the first vend.
    const isSuccess =
      classified.isSuccess ||
      (!!body && !isProcessing && !isFailed && !!readMonnifyBillToken(body));
    if (body && isSuccess) {
      return {
        status: 'successful',
        message: parsed.responseMessage || 'success',
        pin: readMonnifyBillToken(body),
        units: body.metaData?.unit || undefined,
      };
    }
    if (isProcessing) {
      return {
        status: 'processing',
        message: parsed.responseMessage || 'processing',
      };
    }
    if (isFailed) {
      // A FAILED vend that also returns a token contradicts itself (the
      // customer may hold a voucher): not proof, like on the first vend.
      if (body && readMonnifyBillToken(body)) {
        return { status: 'unknown', responseCode, message };
      }
      return { status: 'failed', responseCode, message };
    }
    // No body, or a vend state Monnify did not name: not proof of failure,
    // so the row stays processing (never refunded on it).
    return { status: 'unknown', responseCode, message };
  }

  // A rejected requery is about the query unless it names the vend as
  // failed: code 99 ("re-query"), "not found" and the like leave the row
  // processing instead of refunding a vend Monnify may have delivered.
  // A business 401/403/429 or login wording proves nothing about the vend,
  // even when the body also names it FAILED.
  const isAuthRejection =
    /^\s*0*(?:401|403|429)\s*$/.test(parsed.responseCode) ||
    hasMonnifyAuthOrThrottleCode(envelope) ||
    mentionsMonnifyAuthWording(
      `${message} ${joinMonnifyAnswerStrings(envelope)}`
    );
  return {
    status:
      !isAuthRejection &&
      isMonnifyRequeryRejectionDefiniteFailure({
        envelope,
        rawMessage: message,
      })
        ? 'failed'
        : 'unknown',
    responseCode,
    message,
  };
}
