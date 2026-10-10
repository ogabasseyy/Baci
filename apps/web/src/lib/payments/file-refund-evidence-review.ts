import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import type { RefundRow } from './paystack-cancellation-refund-row';

export async function fileRefundEvidenceReview(
  supabase: SupabaseClient,
  refund: RefundRow,
  reason: string
): Promise<void> {
  const { error } = await supabase.from('reconciliation_review').insert({
    issue_type: 'order_cancellation_refund_requires_review',
    order_id: refund.order_id,
    merchant_id: refund.merchant_id,
    txn_id: refund.id,
    paystack_ref: refund.gateway_reference,
    reason: `Paystack cancellation refund evidence mismatch: ${reason}`,
    metadata: { refund_transaction_id: refund.id, reason },
  });
  if (error?.code === '23505') {
    const { data: merged, error: mergeError } = await supabase.rpc(
      'merge_paystack_cancellation_refund_review_v1',
      {
        p_order_id: refund.order_id,
        p_merchant_id: refund.merchant_id,
        p_refund_id: refund.id,
        p_reason: reason,
      }
    );
    if (mergeError || merged !== true) {
      // The merge only absorbs into this order's open review: a
      // 23505 it cannot absorb means another order owns the
      // (issue_type, paystack_ref) slot (shared reference). Persist
      // this order's review without occupying paystack_ref — as the
      // candidate filers do — so the mismatch is recorded instead
      // of throwing the worker into rotation with no review hold.
      const { error: retryError } = await supabase
        .from('reconciliation_review')
        .insert({
          issue_type: 'order_cancellation_refund_requires_review',
          order_id: refund.order_id,
          merchant_id: refund.merchant_id,
          txn_id: refund.id,
          paystack_ref: null,
          reason: `Paystack cancellation refund evidence mismatch: ${reason}`,
          metadata: { refund_transaction_id: refund.id, reason },
        });
      if (retryError)
        throw new Error('refund_evidence_review_persistence_failed');
    }
  } else if (error) {
    throw new Error('refund_evidence_review_persistence_failed');
  }
  logger.warn({
    message: 'Paystack cancellation refund requires reconciliation review',
    refundId: refund.id,
    orderId: refund.order_id,
    reason,
  });
}
