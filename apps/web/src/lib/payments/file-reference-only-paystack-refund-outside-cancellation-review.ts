import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { referenceOnlyRefundCoveredBySettledRows } from './reference-only-refund-settled-coverage';

/**
 * File non-cancellation evidence for a signed reference-only refund
 * event on an ACTIVE order. The event carries no refund ID, so the
 * cancellation recovery path cannot record it — but the customer may
 * have been refunded while the order stays paid, settleable, and
 * fulfillable, and polling can never rediscover a provider-only
 * refund. Settled local rows that already reconcile the payment stay
 * silent as late duplicates; otherwise the review stays open for
 * operations. One open review per order: redeliveries merge
 * payment-keyed evidence into it. Throws on write failure for
 * redelivery.
 */
export async function fileReferenceOnlyPaystackRefundOutsideCancellationReview(
  supabase: SupabaseClient,
  {
    amount,
    currency,
    merchantId,
    orderId,
    orderNumber,
    paymentId,
    paymentReference,
  }: {
    amount: number;
    currency: string;
    merchantId: string;
    orderId: string;
    orderNumber: string | null;
    paymentId: string;
    paymentReference: string;
  }
): Promise<void> {
  const covered = await referenceOnlyRefundCoveredBySettledRows(supabase, {
    amount,
    currency,
    merchantId,
    orderId,
    paymentId,
  });
  if (covered) return;

  const orderLabel = orderNumber || orderId.slice(0, 8).toUpperCase();
  const reason =
    `Paystack refund event for payment ${paymentReference} on active ` +
    `order #${orderLabel} has no local audit row; verify the provider ` +
    `refund before fulfillment or settlement`;
  const candidates = [
    {
      amount,
      currency,
      gateway: 'paystack',
      gatewayReference: paymentReference,
      order_id: orderId,
      payment_transaction_id: paymentId,
    },
  ];
  const evidenceKey = `payment:${paymentId}`;
  const evidence = {
    payment_transaction_id: paymentId,
    payment_reference: paymentReference,
    payment_amount: amount,
    payment_currency: currency,
    reference_only_refund_event: true,
    reason: reason.slice(0, 120),
    observed_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('reconciliation_review').insert({
    candidates,
    issue_type: 'provider_refund_outside_cancellation',
    merchant_id: merchantId,
    metadata: {
      audit_record_failed: true,
      payment_transaction_id: paymentId,
      reference: paymentReference,
      reference_only_refund_event: true,
    },
    order_id: orderId,
    // Deliberately unset: a shared or corrupt reference spans orders,
    // and the open-by-paystack-ref index would collapse all but the
    // first order's review.
    paystack_ref: null,
    reason,
    txn_id: null,
  });
  if (!error) {
    logger.warn({
      message:
        'Paystack reference-only refund event on an active order has no local audit row',
      orderId,
      paymentId,
      paymentReference,
    });
    return;
  }
  if ((error as { code?: string }).code !== '23505') {
    throw new Error('reference_only_refund_review_persistence_failed');
  }
  const { data: merged, error: mergeError } = await supabase.rpc(
    'merge_provider_refund_outside_cancellation_evidence_v1',
    {
      p_order_id: orderId,
      p_merchant_id: merchantId,
      p_evidence_key: evidenceKey,
      p_evidence: evidence,
      p_candidates: candidates,
    }
  );
  if (mergeError || merged !== true) {
    throw new Error('reference_only_refund_review_persistence_failed');
  }
}
