import type { PurchaseResult } from '@/lib/kuda';
import {
  monnifyEnvelopeSchema,
  requeryResponseBodySchema,
  validateCustomerRequestSchema,
  validateCustomerResponseBodySchema,
  vendRequestSchema,
  vendResponseBodySchema,
} from '@/schemas/monnify-bills-schema';
import { joinMonnifyAnswerStrings } from './monnify-answer-strings';
import {
  MonnifyHttpError,
  MonnifyTransientVendError,
  sanitizeMonnifyErrorDetail,
} from './monnify-bills-errors';
import { monnifyRequest } from './monnify-bills-request';
import {
  getMonnifyEnvelopeMessage,
  isMonnifyBusinessSuccess,
  MONNIFY_FINANCIAL_TIMEOUT_MS,
} from './monnify-bills-shared';
import { classifyMonnifyBillStatus } from './monnify-bills-status';
import { isMonnifyDuplicateReferenceText } from './monnify-duplicate-reference';
import { isMonnifyUnexpectedErrorCode } from './monnify-unexpected-error';
import { reportsMonnifyUnexpectedError } from './monnify-unexpected-error-text';
import { hasMonnifyVendEvidence } from './monnify-vend-evidence';
import { mentionsMonnifyVendEvidence } from './monnify-vend-evidence-text';
import { isMonnifyVendOutcomeText } from './monnify-vend-outcome';
import { isMonnifyKnownVendRefusalText } from './monnify-vend-refusal';

export async function verifyBillCustomer(
  _billerCode: string,
  productCode: string,
  customerIdentifier: string
): Promise<{
  verified: boolean;
  customerName?: string;
  address?: string;
  message: string;
  validationReference?: string;
  requireValidationRef?: boolean;
}> {
  try {
    const payload = validateCustomerRequestSchema.parse({
      productCode,
      customerId: customerIdentifier,
    });
    const envelope = await monnifyRequest(
      '/api/v1/vas/bills-payment/validate-customer',
      {
        method: 'POST',
        timeoutMs: MONNIFY_FINANCIAL_TIMEOUT_MS,
        body: JSON.stringify(payload),
      }
    );
    const parsed = monnifyEnvelopeSchema(
      validateCustomerResponseBodySchema
    ).parse(envelope);

    if (isMonnifyBusinessSuccess(parsed) && parsed.responseBody) {
      const body = parsed.responseBody;
      return {
        verified: true,
        customerName: body.customerName || undefined,
        address: body.address || undefined,
        validationReference:
          body.validationReference ||
          body.vendInstruction?.validationReference ||
          undefined,
        requireValidationRef:
          body.requireValidationRef ??
          body.vendInstruction?.requireValidationRef ??
          false,
        message: parsed.responseMessage || 'Validation successful',
      };
    }

    return {
      verified: false,
      message: getMonnifyEnvelopeMessage({
        fallback: 'Validation failed',
        responseCode: parsed.responseCode,
        responseMessage: parsed.responseMessage,
      }),
    };
  } catch (error) {
    return {
      verified: false,
      message:
        error instanceof MonnifyHttpError
          ? 'Verification could not be completed with Monnify. Please check the details and try again.'
          : error instanceof Error
            ? error.message
            : 'Verification failed',
    };
  }
}

export async function purchaseBill(
  _billerCode: string,
  productCode: string,
  customerIdentifier: string,
  amount: number,
  _customerName: string,
  requestReference: string,
  _customerPhone?: string,
  validationReference?: string
): Promise<PurchaseResult> {
  try {
    const payload = vendRequestSchema.parse({
      productCode,
      amount,
      vendAmount: amount,
      customerId: customerIdentifier,
      vendReference: requestReference,
      validationReference,
    });
    const envelope = await monnifyRequest('/api/v1/vas/bills-payment/vend', {
      method: 'POST',
      timeoutMs: MONNIFY_FINANCIAL_TIMEOUT_MS,
      body: JSON.stringify(payload),
    });
    const parsedEnvelope = monnifyEnvelopeSchema(vendResponseBodySchema).parse(
      envelope
    );

    if (!isMonnifyBusinessSuccess(parsedEnvelope)) {
      const rawMessage = getMonnifyEnvelopeMessage({
        fallback: 'Monnify business failure',
        responseCode: parsedEnvelope.responseCode,
        responseMessage: parsedEnvelope.responseMessage,
      });
      const envelopeText = JSON.stringify(envelope);
      const fullAnswer = `${parsedEnvelope.responseCode ?? ''} ${rawMessage} ${envelopeText}`;
      return {
        success: false,
        reference: requestReference,
        // Scrubbed like HTTP error details: Monnify may echo the customer's
        // number, and this text is persisted and logged. Classification
        // below reads the full text, before it is cut short.
        message: sanitizeMonnifyErrorDetail(rawMessage),
        status: 'failed',
        amount,
        // Every check reads the whole answer (code, message and body), so a
        // signal nested anywhere in it counts. Code 99 ("unexpected error,
        // re-query"), vend evidence, outcome wording and duplicates rule a
        // refusal out; a known refusal anywhere rules it in.
        providerDefiniteFailure:
          !isMonnifyUnexpectedErrorCode(parsedEnvelope.responseCode) &&
          // Timeout, conflict and throttle codes prove nothing was vended
          // no more here than as HTTP statuses.
          !/^\s*(?:408|409|429)\s*$/.test(parsedEnvelope.responseCode ?? '') &&
          !reportsMonnifyUnexpectedError(envelopeText) &&
          !hasMonnifyVendEvidence(envelope) &&
          !mentionsMonnifyVendEvidence(joinMonnifyAnswerStrings(envelope)) &&
          isMonnifyKnownVendRefusalText(fullAnswer) &&
          !isMonnifyVendOutcomeText(fullAnswer) &&
          !isMonnifyDuplicateReferenceText(fullAnswer),
      };
    }

    const body = parsedEnvelope.responseBody;
    if (!body) {
      throw new MonnifyTransientVendError(
        'Monnify vend response missing responseBody'
      );
    }

    const transactionReference = body.transactionReference || undefined;
    const vendReference = body.vendReference || undefined;
    const { isSuccess, isProcessing, isFailed } =
      classifyMonnifyBillStatus(body);

    if (isSuccess && !transactionReference && !vendReference) {
      throw new MonnifyTransientVendError(
        'Monnify success vend response missing both transaction and vend references'
      );
    }
    if (isProcessing && !vendReference) {
      throw new MonnifyTransientVendError(
        'Monnify pending vend response missing a requeryable vend reference'
      );
    }

    const status = isSuccess
      ? 'successful'
      : isProcessing
        ? 'pending'
        : 'failed';
    return {
      success: isSuccess || isProcessing,
      reference: requestReference,
      transactionId: transactionReference ?? vendReference,
      providerVendReference: vendReference,
      pin: body.metaData?.token || body.token || undefined,
      units: body.metaData?.unit || undefined,
      message: sanitizeMonnifyErrorDetail(
        parsedEnvelope.responseMessage ||
          (isFailed ? 'Vend request failed' : 'Vend request completed')
      ),
      status,
      amount,
    };
  } catch (error) {
    if (error instanceof MonnifyHttpError && error.isClientError) {
      return {
        success: false,
        reference: requestReference,
        message:
          'Monnify rejected the bill payment request. Please verify the details and try again.',
        providerErrorDetail: error.diagnosticMessage,
        status: 'failed',
        amount,
        // A refusal Monnify gave before vending: an authentication rejection
        // (401/403, e.g. a cached token rejected) or a known refusal. A 401/403
        // comes from the vend request's own bearer-token check, which runs
        // before the request is processed, so nothing was vended; a failed
        // token login never gets this far (it throws a plain Error from
        // getMonnifyToken and stays an unknown outcome). A timeout
        // (408) or anything that may be a duplicate never qualifies.
        // Any answer that talks about the service being unavailable or a
        // failed vend may come after a vend that ran (e.g. from a gateway),
        // so it never qualifies, whatever else it says, and nor does a body
        // that carries a vend status or reference. A 429 never qualifies: a
        // throttle (possibly from a gateway) does not prove nothing was vended.
        providerDefiniteFailure:
          error.status !== 408 &&
          !error.isDuplicateReference &&
          !error.reportsUnexpectedError &&
          !error.mentionsVendOutcome &&
          error.status !== 429 &&
          !error.showsVendEvidence &&
          (((error.status === 401 || error.status === 403) &&
            error.readsAsAuthRejection) ||
            error.isKnownRefusal),
      };
    }

    const errorMsg =
      error instanceof MonnifyHttpError
        ? error.diagnosticMessage
        : error instanceof Error
          ? error.message
          : String(error);
    if (error instanceof MonnifyTransientVendError) {
      throw error;
    }
    throw new MonnifyTransientVendError(`Transient vend outcome: ${errorMsg}`);
  }
}

export async function checkTransactionStatus(
  transactionReference: string
): Promise<{ status: string; message: string; pin?: string; units?: string }> {
  const envelope = await monnifyRequest(
    `/api/v1/vas/bills-payment/requery?reference=${encodeURIComponent(transactionReference)}`,
    { method: 'GET', timeoutMs: MONNIFY_FINANCIAL_TIMEOUT_MS }
  );
  const parsed = monnifyEnvelopeSchema(requeryResponseBodySchema).parse(
    envelope
  );

  if (isMonnifyBusinessSuccess(parsed) && parsed.responseBody) {
    const body = parsed.responseBody;
    const { isSuccess, isProcessing } = classifyMonnifyBillStatus(body);
    if (isSuccess) {
      return {
        status: 'successful',
        message: parsed.responseMessage || 'success',
        pin: body.metaData?.token || body.token || undefined,
        units: body.metaData?.unit || undefined,
      };
    }
    if (isProcessing) {
      return {
        status: 'processing',
        message: parsed.responseMessage || 'processing',
      };
    }
  }

  return {
    status: 'failed',
    message: getMonnifyEnvelopeMessage({
      fallback: 'failed',
      responseCode: parsed.responseCode,
      responseMessage: parsed.responseMessage,
    }),
  };
}
