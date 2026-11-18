import type { PurchaseResult } from '@/lib/kuda';
import {
  monnifyEnvelopeSchema,
  requeryResponseBodySchema,
  validateCustomerRequestSchema,
  validateCustomerResponseBodySchema,
  vendRequestSchema,
  vendResponseBodySchema,
} from '@/schemas/monnify-bills-schema';
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
import { isMonnifyDefiniteBusinessRefusal } from './monnify-business-refusal';
import { readMonnifyResponseCode } from './monnify-response-code';

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
      return {
        success: false,
        reference: requestReference,
        // Scrubbed like HTTP error details: Monnify may echo the customer's
        // number, and this text is persisted and logged. Classification
        // reads the full answer, before it is cut short.
        message: sanitizeMonnifyErrorDetail(rawMessage),
        status: 'failed',
        amount,
        providerDefiniteFailure: isMonnifyDefiniteBusinessRefusal({
          envelope,
          rawMessage,
          responseCode: parsedEnvelope.responseCode,
        }),
        providerResponseCode: readMonnifyResponseCode(parsedEnvelope),
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
        providerResponseCode: error.responseCode,
        status: 'failed',
        amount,
        // A refusal Monnify gave before vending: a known refusal (the amount
        // check, Baci's Monnify float too low). A 401/403 never qualifies
        // (owner decision): Monnify does not document that its auth check runs
        // before any vend, so a login rejection is refunded, not re-vended. A
        // timeout (408), a throttle (429) or anything that may be a duplicate
        // never qualifies. Any answer that talks about the service being
        // unavailable or a vend outcome, or whose body carries a vend status or
        // reference, may come after a vend that ran, so it never qualifies.
        providerDefiniteFailure:
          // Only reachable for 4xx (isClientError above); kept explicit so a
          // future refactor can never let a 5xx (unknown outcome) through.
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
          error.isKnownRefusal,
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
