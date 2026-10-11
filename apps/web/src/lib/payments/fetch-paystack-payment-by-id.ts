import type {
  PaymentVerificationResponse,
  PaystackResult,
} from '@/lib/paystack';
import { paystackRequest } from '@/lib/paystack-request';

/** Resolve a refund's numeric transaction ID to its verified reference. */
export function fetchPaystackPaymentById(
  id: number,
  signal?: AbortSignal
): Promise<PaystackResult<PaymentVerificationResponse>> {
  if (!Number.isSafeInteger(id) || id <= 0) {
    return Promise.resolve({
      success: false,
      error: 'Invalid transaction ID',
      code: 'VALIDATION_ERROR',
    });
  }
  return paystackRequest(`/transaction/${id}`, { signal });
}
