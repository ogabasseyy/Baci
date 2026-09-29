import type { SupabaseClient } from '@supabase/supabase-js';

export interface ActiveOrderPaystackRefundReview {
  amount: number;
  currency: string;
  merchantId: string;
  orderId: string;
  orderNumber: string | null;
  paymentId: string;
  paymentReference: string | null;
  providerPaymentTransactionId: number;
  providerRefundId: number;
  providerRefundStatus: string;
}

/**
 * File a review for a provider-verified refund on an order that is not
 * cancelled. The cancellation recovery path cannot record these, but the
 * customer was refunded while the order stays paid and fulfillable, so
 * the evidence must reach operations instead of being acknowledged
 * silently. Redelivery of the same provider refund conflicts on
 * paystack_ref and reads as already filed; a different refund on the
 * same order files its own row. Throws on write failure for redelivery.
 */
export async function fileProviderRefundOutsideCancellationReview(
  supabase: SupabaseClient,
  review: ActiveOrderPaystackRefundReview
): Promise<void> {
  const orderLabel =
    review.orderNumber || review.orderId.slice(0, 8).toUpperCase();
  const { error } = await supabase.from('reconciliation_review').insert({
    issue_type: 'provider_refund_outside_cancellation',
    order_id: review.orderId,
    merchant_id: review.merchantId,
    paystack_ref: String(review.providerRefundId),
    reason: `Paystack refund ${review.providerRefundId} was verified for active order #${orderLabel}; reconcile the order and its settlement before fulfillment`,
    candidates: [
      {
        payment_transaction_id: review.paymentId,
        order_id: review.orderId,
        amount: review.amount,
        gateway_reference: review.paymentReference,
      },
    ],
    metadata: {
      provider_refund_id: review.providerRefundId,
      provider_payment_transaction_id: review.providerPaymentTransactionId,
      payment_transaction_id: review.paymentId,
      provider_refund_status: review.providerRefundStatus,
      refund_amount: review.amount,
      refund_currency: review.currency,
    },
  });
  if (!error) return;
  if ((error as { code?: string }).code === '23505') return;
  throw new Error('active_order_refund_review_failed');
}
