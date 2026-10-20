import type {
  PaymentVerificationResponse,
  PaystackResult,
} from '@/lib/paystack';
import { paystackRequest } from '@/lib/paystack-request';

export type PaystackPaymentById = Omit<PaymentVerificationResponse, 'id'> & {
  id: string;
};

/**
 * Resolve a refund's decimal-text transaction ID to its verified
 * reference. The ID travels as text both ways: Paystack IDs are
 * unsigned 64-bit, so a numeric parse would round adjacent large IDs
 * equal before the caller's identity check compares them. Older
 * callers pass safe numbers; the response id quotes off the wire
 * text before parsing like the list path.
 */
export function fetchPaystackPaymentById(
  id: number | string,
  signal?: AbortSignal
): Promise<PaystackResult<PaystackPaymentById>> {
  const idText =
    typeof id === 'string' && /^[1-9][0-9]*$/.test(id)
      ? id
      : typeof id === 'number' && Number.isSafeInteger(id) && id > 0
        ? String(id)
        : null;
  if (idText === null) {
    return Promise.resolve({
      success: false,
      error: 'Invalid transaction ID',
      code: 'VALIDATION_ERROR',
    });
  }
  const quoteWirePaymentId = (raw: string): string =>
    raw.replace(/"id"\s*:\s*(\d+)/g, '"id":"$1"');
  return paystackRequest(`/transaction/${idText}`, {
    signal,
    preprocessResponseText: quoteWirePaymentId,
  });
}
