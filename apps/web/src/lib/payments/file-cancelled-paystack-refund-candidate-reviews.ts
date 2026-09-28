import type { SupabaseClient } from '@supabase/supabase-js';
import {
  filePaystackRefundCandidateReviews,
  type RefundRecoveryEvidence,
} from './file-paystack-refund-candidate-reviews';

interface CandidatePayment {
  amount: number;
  gateway_reference: string | null;
  id: string;
  merchant_id: string;
  order_id: string | null;
}

interface CandidateOrder {
  cancelled_at: string | null;
  id: string;
  shipping_status: string | null;
}

function isCancelledOrder(order: CandidateOrder): boolean {
  return (
    order.cancelled_at != null &&
    (order.shipping_status === 'cancelled' ||
      order.shipping_status === 'canceled')
  );
}

/**
 * File candidate reviews only for candidates on cancelled orders. A
 * verified provider refund matching a payment on an ACTIVE order is
 * merchant evidence, not cancellation evidence: filing it into the
 * cancellation queue would misroute it and let it absorb a future
 * genuine cancellation's evidence. Shared by the ambiguous-match and
 * stalled-payment recovery paths; files nothing when no candidate is
 * on a cancelled order.
 */
export async function fileCancelledPaystackRefundCandidateReviews(
  supabase: SupabaseClient,
  candidates: CandidatePayment[],
  evidence: RefundRecoveryEvidence,
  reason: string
): Promise<void> {
  const orderIds = [
    ...new Set(
      candidates
        .map((candidate) => candidate.order_id)
        .filter((id): id is string => typeof id === 'string')
    ),
  ];
  const cancelled = new Set<string>();
  if (orderIds.length > 0) {
    const { data: orders, error: orderError } = await supabase
      .from('orders')
      .select('id, cancelled_at, shipping_status')
      .in('id', orderIds);
    if (orderError) throw new Error('refund_event_order_lookup_failed');
    for (const order of (orders ?? []) as CandidateOrder[]) {
      if (isCancelledOrder(order)) cancelled.add(order.id);
    }
  }
  const reviewable = candidates.filter(
    (candidate) =>
      candidate.order_id !== null && cancelled.has(candidate.order_id)
  );
  if (reviewable.length === 0) return;
  await filePaystackRefundCandidateReviews(
    supabase,
    reviewable,
    evidence,
    reason
  );
}
