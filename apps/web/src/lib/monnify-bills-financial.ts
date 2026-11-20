import type { PurchaseResult } from '@/lib/kuda';
import {
  monnifyEnvelopeSchema,
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
import {
  classifyMonnifyBillStatus,
  hasConflictingVendStatuses,
  isMonnifyPlainFreshDecline,
  readMonnifyBillToken,
  toBillStatusInput,
} from './monnify-bills-status';
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

    const transactionReference = body.transactionReference?.trim() || undefined;
    const vendReference = body.vendReference?.trim() || undefined;
    const classified = classifyMonnifyBillStatus(toBillStatusInput(body));
    const { isProcessing, isFailed } = classified;
    // A delivered token is conclusive even when the status is missing or a
    // state we do not know: without it the customer would never get the
    // voucher they paid for.
    const hasToken = !!readMonnifyBillToken(body);
    const isSuccess =
      classified.isSuccess || (hasToken && !isProcessing && !isFailed);

    if (hasConflictingVendStatuses(body)) {
      // vendStatus and transactionStatus contradict each other: hold.
      return buildMonnifyUnresolvedVendResult({
        amount,
        message: sanitizeMonnifyErrorDetail(
          parsedEnvelope.responseMessage || 'Vend outcome unclear'
        ),
        ...(hasToken && { providerTokenSeen: true }),
        providerVendReference: vendReference,
        requestReference,
      });
    }

    // A delivered token is enough on its own: throwing for a missing reference
    // here would re-vend an already-delivered purchase.
    if (isSuccess && !transactionReference && !vendReference && !hasToken) {
      throw new MonnifyTransientVendError(
        'Monnify success vend response missing both transaction and vend references'
      );
    }
    if (isProcessing && !vendReference && hasToken) {
      // Pending but already carrying a token, and nothing to requery by: hold
      // it (the token is not stored on a pending row) instead of re-vending.
      return buildMonnifyUnresolvedVendResult({
        amount,
        message: sanitizeMonnifyErrorDetail(
          parsedEnvelope.responseMessage || 'Vend outcome unclear'
        ),
        providerTokenSeen: true,
        requestReference,
      });
    }
    if (isProcessing && !vendReference) {
      throw new MonnifyTransientVendError(
        'Monnify pending vend response missing a requeryable vend reference'
      );
    }

    if (isSuccess && !classified.isSuccess) {
      // A token completed this vend although its status was missing or not
      // one we know: a fixed label (no provider text) so support can spot a
      // bad-token pattern.
      console.warn('Monnify vend settled on a token with an unnamed status');
    }
    const isFreshDecline = isMonnifyPlainFreshDecline(
      body,
      hasToken || !!vendReference || !!transactionReference
    );
    if (
      !isFreshDecline &&
      ((!isSuccess && !isProcessing && !isFailed) || (isFailed && hasToken))
    ) {
      // A vend state Monnify did not name as success, in progress or failed
      // (missing, REVERSED, UNKNOWN...) proves nothing: hold, never refund.
      // A FAILED vend that also carries a token contradicts itself (the
      // customer may hold a voucher): hold it too.
      return buildMonnifyUnresolvedVendResult({
        amount,
        message: sanitizeMonnifyErrorDetail(
          parsedEnvelope.responseMessage || 'Vend outcome unclear'
        ),
        ...(hasToken && { providerTokenSeen: true }),
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
      // Only a completed vend carries its token: a pending row holding a
      // voucherPin would never settle or notify (reconciliation fills it in).
      pin: status === 'successful' ? readMonnifyBillToken(body) : undefined,
      units: body.metaData?.unit || undefined,
      message: sanitizeMonnifyErrorDetail(
        parsedEnvelope.responseMessage ||
          (isFailed ? 'Vend request failed' : 'Vend request completed')
      ),
      status,
      amount,
      // A pending vend that already carries a token: flag it (the token is not
      // stored on a processing row) so support knows a voucher was issued.
      ...(status === 'pending' && hasToken && { providerTokenSeen: true }),
    };
  } catch (error) {
    // A 4xx is a rejection; an HTTP 5xx that already carries a voucher token is
    // held too (a retry could submit after delivery).
    if (
      error instanceof MonnifyHttpError &&
      (error.isClientError ||
        error.bodyHasToken ||
        // A body that says the vend was delivered: a retry would pay it twice.
        error.showsDeliveredStatus ||
        // Monnify already identified the vend: hold and requery it, don't re-vend.
        !!error.providerVendReference(requestReference))
    ) {
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

export { checkTransactionStatus } from './monnify-bills-requery-status';
