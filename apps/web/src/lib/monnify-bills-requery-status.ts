import {
  monnifyEnvelopeSchema,
  requeryResponseBodySchema,
} from '@/schemas/monnify-bills-schema';
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
      ![401, 403, 429].includes(error.status) &&
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
  return {
    status: isMonnifyRequeryRejectionDefiniteFailure({
      envelope,
      rawMessage: message,
    })
      ? 'failed'
      : 'unknown',
    responseCode,
    message,
  };
}
