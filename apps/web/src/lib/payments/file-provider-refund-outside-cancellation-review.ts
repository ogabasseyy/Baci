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
  /** Ambiguous matches name every candidate payment in one reason. */
  reason?: string;
}

interface RefundCandidate {
  amount: number;
  gateway_reference: string | null;
  id: string;
  merchant_id: string;
  order_id: string | null;
}

function evidenceOf(review: ActiveOrderPaystackRefundReview) {
  return {
    [`provider:${review.providerRefundId}`]: {
      payment_transaction_id: review.paymentId,
      provider_payment_transaction_id: review.providerPaymentTransactionId,
      provider_refund_status: review.providerRefundStatus,
      refund_amount: review.amount,
      refund_currency: review.currency,
      reason: (review.reason ?? '').slice(0, 120),
      observed_at: new Date().toISOString(),
    },
  };
}

/**
 * File a review for a provider-verified refund on an order that is not
 * cancelled. The cancellation recovery path cannot record these, but the
 * customer was refunded while the order stays paid and fulfillable, so
 * the evidence must reach operations instead of being acknowledged
 * silently. One open review per order: redelivery and later refunds
 * merge provider-keyed evidence into it, so concurrent webhooks cannot
 * clobber each other. Throws on write failure for redelivery.
 */
export async function fileProviderRefundOutsideCancellationReview(
  supabase: SupabaseClient,
  review: ActiveOrderPaystackRefundReview
): Promise<void> {
  const orderLabel =
    review.orderNumber || review.orderId.slice(0, 8).toUpperCase();
  const reason =
    review.reason ??
    `Paystack refund ${review.providerRefundId} was verified for active order #${orderLabel}; reconcile the order and its settlement before fulfillment`;
  const candidates = [
    {
      payment_transaction_id: review.paymentId,
      order_id: review.orderId,
      amount: review.amount,
      gateway_reference: review.paymentReference,
    },
  ];
  const { error } = await supabase.from('reconciliation_review').insert({
    issue_type: 'provider_refund_outside_cancellation',
    order_id: review.orderId,
    merchant_id: review.merchantId,
    // Deliberately unset: every candidate review shares this provider
    // refund, and the open-by-paystack-ref index would collapse all but
    // the first order's review.
    paystack_ref: null,
    txn_id: null,
    reason,
    candidates,
    metadata: {
      provider_refund_id: review.providerRefundId,
      provider_payment_transaction_id: review.providerPaymentTransactionId,
      payment_transaction_id: review.paymentId,
      refund_evidence: evidenceOf({ ...review, reason }),
    },
  });
  if (!error) return;
  if ((error as { code?: string }).code !== '23505') {
    throw new Error('active_order_refund_review_failed');
  }
  const { data: merged, error: mergeError } = await supabase.rpc(
    'merge_provider_refund_outside_cancellation_evidence_v1',
    {
      p_order_id: review.orderId,
      p_merchant_id: review.merchantId,
      p_evidence_key: `provider:${review.providerRefundId}`,
      p_evidence: evidenceOf({ ...review, reason })[
        `provider:${review.providerRefundId}`
      ],
      p_candidates: candidates,
    }
  );
  if (mergeError || merged !== true) {
    throw new Error('active_order_refund_review_failed');
  }
}

/**
 * File non-cancellation evidence for ambiguous-match candidates on
 * active orders. The cancellation candidate helper drops these (they
 * must not absorb a future genuine cancellation's evidence), but the
 * verified provider refund still needs operations eyes on every order
 * it might belong to. Files nothing when every candidate is cancelled.
 */
export async function fileActiveOrderPaystackRefundCandidateReviews(
  supabase: SupabaseClient,
  candidates: RefundCandidate[],
  evidence: {
    providerPaymentTransactionId: number;
    providerRefundId: number;
    reference: string;
  },
  reason: string,
  refund: { amount: number; currency: string; status: string }
): Promise<void> {
  const orderIds = [
    ...new Set(
      candidates
        .map((candidate) => candidate.order_id)
        .filter((id): id is string => typeof id === 'string')
    ),
  ];
  const active = new Map<string, string>();
  if (orderIds.length > 0) {
    const { data: orders, error: orderError } = await supabase
      .from('orders')
      .select('id, order_number, cancelled_at, shipping_status')
      .in('id', orderIds);
    if (orderError) throw new Error('refund_event_order_lookup_failed');
    for (const order of (orders ?? []) as Array<{
      cancelled_at: string | null;
      id: string;
      order_number: string | null;
      shipping_status: string | null;
    }>) {
      const cancelled =
        order.cancelled_at != null &&
        (order.shipping_status === 'cancelled' ||
          order.shipping_status === 'canceled');
      if (!cancelled) {
        active.set(order.id, order.order_number ?? order.id.slice(0, 8));
      }
    }
  }
  for (const candidate of candidates) {
    if (!candidate.order_id || !active.has(candidate.order_id)) continue;
    const orderNumber = active.get(candidate.order_id);
    if (orderNumber === undefined) continue;
    active.delete(candidate.order_id);
    await fileProviderRefundOutsideCancellationReview(supabase, {
      amount: refund.amount,
      currency: refund.currency,
      merchantId: candidate.merchant_id,
      orderId: candidate.order_id,
      orderNumber,
      paymentId: candidate.id,
      paymentReference: candidate.gateway_reference,
      providerPaymentTransactionId: evidence.providerPaymentTransactionId,
      providerRefundId: evidence.providerRefundId,
      providerRefundStatus: refund.status,
      reason,
    });
  }
}
