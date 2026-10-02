import { logger } from '@/lib/logger';
import { selectPaystackRefundReference } from '@/lib/select-paystack-refund-reference';
import { fetchPaystackPaymentById } from './fetch-paystack-payment-by-id';
import { fetchRefund } from './fetch-paystack-refund';

const PROVIDER_READ_TIMEOUT_MS = 8_000;

export interface VerifiedUnknownRefundProvider {
  current: {
    amount: number;
    currency: string;
    id: number;
    status: string;
    transaction: number;
  };
  resolvedPaymentReference: string;
}

/**
 * Re-verify an unknown provider refund and resolve its authoritative
 * payment: a signed event is only a wake-up hint, so the refund and its
 * payment are read back from Paystack, the payment must be the
 * transaction the refund points at, and the webhook reference is only
 * a hint that may be stale. A stale hint is logged but never blocks
 * recovery of the verified refund. Unverifiable states throw so
 * Paystack can redeliver.
 */
export async function verifyUnknownPaystackRefundProvider(
  refundId: number,
  paymentReference?: string
): Promise<VerifiedUnknownRefundProvider> {
  const providerRefund = await fetchRefund(
    refundId,
    AbortSignal.timeout(PROVIDER_READ_TIMEOUT_MS)
  );
  if (!providerRefund.success) {
    throw new Error('paystack_refund_verification_unavailable');
  }
  const current = providerRefund.data;
  if (!Number.isSafeInteger(current.transaction) || current.transaction <= 0) {
    // Carry the raw payload: the caller files it as invalid evidence
    // before rejecting, so a malformed transaction leaves a durable
    // trace instead of 503ing with nothing recorded.
    const error = new Error('paystack_refund_transaction_invalid') as Error & {
      providerRefund?: unknown;
    };
    error.providerRefund = current;
    throw error;
  }
  // Always resolve the payment from the refund's own numeric transaction
  // ID: the webhook reference is only a hint and may be stale. A stale
  // hint is logged but never blocks recovery of the verified refund.
  const fetchedPayment = await fetchPaystackPaymentById(
    current.transaction,
    AbortSignal.timeout(PROVIDER_READ_TIMEOUT_MS)
  );
  if (!fetchedPayment.success) {
    throw new Error('paystack_refund_payment_lookup_unavailable');
  }
  if (fetchedPayment.data.id !== current.transaction) {
    throw new Error('paystack_refund_payment_lookup_mismatch');
  }
  const resolvedPaymentReference = fetchedPayment.data.reference;
  if (
    paymentReference !== undefined &&
    paymentReference !== resolvedPaymentReference
  ) {
    logger.info({
      message:
        'Unknown Paystack refund event reference is stale; using the authoritative payment',
      refundId,
    });
  }
  // The recovery path shares the webhook's reference alphabet: a reference
  // the selector will not pick is unusable downstream.
  if (
    typeof resolvedPaymentReference !== 'string' ||
    selectPaystackRefundReference(resolvedPaymentReference, undefined) !==
      resolvedPaymentReference
  ) {
    throw new Error('paystack_refund_payment_reference_invalid');
  }
  return { current, resolvedPaymentReference };
}
