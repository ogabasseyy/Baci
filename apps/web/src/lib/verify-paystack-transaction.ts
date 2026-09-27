import { logger } from './logger';
import {
  type PaymentVerificationResponse,
  PaymentVerificationSchema,
  type PaystackResult,
} from './paystack';
import { paystackRequest } from './paystack-request';

/**
 * Verify a Paystack transaction
 */
export async function verifyTransaction(
  reference: string,
  signal?: AbortSignal
): Promise<PaystackResult<PaymentVerificationResponse>> {
  // Validate reference format to prevent SSRF attacks
  // Paystack references are typically alphanumeric with some special chars
  if (!reference || !/^[A-Za-z0-9_-]{1,100}$/.test(reference)) {
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
