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
import { isMonnifyRequeryRejectionDefiniteFailure } from './monnify-requery-rejection';
import { readMonnifyResponseCode } from './monnify-response-code';
import { buildMonnifyUnresolvedVendResult } from './monnify-unresolved-vend-result';
import {
  buildMonnifyBusinessRejectionResult,
  buildMonnifyHttpRejectionResult,
} from './monnify-vend-rejection-result';

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
      return buildMonnifyBusinessRejectionResult({
        amount,
        envelope,
        parsedEnvelope,
        requestReference,
      });
    }

    const body = parsedEnvelope.responseBody;
    if (!body) {
      throw new MonnifyTransientVendError(
        'Monnify vend response missing responseBody'
      );
    }

    const transactionReference = body.transactionReference || undefined;
    const vendReference = body.vendReference || undefined;
    const classified = classifyMonnifyBillStatus(body);
    const { isProcessing, isFailed } = classified;
    // A delivered token is conclusive even when the status is missing or a
    // state we do not know: without it the customer would never get the
    // voucher they paid for.
    const hasToken = !!(body.metaData?.token || body.token);
    const isSuccess =
      classified.isSuccess || (hasToken && !isProcessing && !isFailed);

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

    if (!isSuccess && !isProcessing && !isFailed) {
      // A vend state Monnify did not name as success, in progress or failed
      // (missing, REVERSED, UNKNOWN...) proves nothing: hold, never refund.
      return buildMonnifyUnresolvedVendResult({
        amount,
        message: sanitizeMonnifyErrorDetail(
          parsedEnvelope.responseMessage || 'Vend outcome unclear'
        ),
        providerVendReference: vendReference,
        requestReference,
      });
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
      return buildMonnifyHttpRejectionResult({
        amount,
        error,
        requestReference,
      });
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
): Promise<{
  /** 'successful' | 'processing' | 'failed' | 'unknown' ('unknown' proves nothing: never refund on it). */
  status: string;
  message: string;
  pin?: string;
  responseCode?: string;
  units?: string;
}> {
  const envelope = await monnifyRequest(
    `/api/v1/vas/bills-payment/requery?reference=${encodeURIComponent(transactionReference)}`,
    { method: 'GET', timeoutMs: MONNIFY_FINANCIAL_TIMEOUT_MS }
  );
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
    const classified = body
      ? classifyMonnifyBillStatus(body)
      : { isSuccess: false, isProcessing: false, isFailed: false };
    const { isProcessing, isFailed } = classified;
    // A returned token is conclusive even with a missing or unrecognised
    // status, like on the first vend.
    const isSuccess =
      classified.isSuccess ||
      (!!body &&
        !isProcessing &&
        !isFailed &&
        !!(body.metaData?.token || body.token));
    if (body && isSuccess) {
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
    if (isFailed) {
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
