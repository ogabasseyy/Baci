import { logger } from './logger';
import {
  type PaymentVerificationResponse,
  PaymentVerificationSchema,
  type PaystackResult,
} from './paystack';
import { paystackRequest } from './paystack-request';
import { selectPaystackRefundReference } from './select-paystack-refund-reference';

/**
 * Verify a Paystack transaction
 */
export async function verifyTransaction(
  reference: string,
  signal?: AbortSignal
): Promise<PaystackResult<PaymentVerificationResponse>> {
  // Validate reference format to prevent SSRF attacks. Share the
  // webhook/recovery alphabet: dots and equals signs stay safe because the
  // reference is encoded into the request path below.
  if (selectPaystackRefundReference(reference, undefined) !== reference) {
    return {
      success: false,
      error: 'Invalid transaction reference format',
      code: 'VALIDATION_ERROR',
    };
  }

  const result = await paystackRequest<PaymentVerificationResponse>(
    `/transaction/verify/${encodeURIComponent(reference)}`,
    { signal }
  );

  if (!result.success) {
    return result;
  }

  // Validate response
  const parsed = PaymentVerificationSchema.safeParse(result.data);
  if (!parsed.success) {
    logger.warn({
      message: 'Payment verification response validation warning',
      issues: parsed.error.issues,
    });
  }

  return { success: true, data: result.data };
}
