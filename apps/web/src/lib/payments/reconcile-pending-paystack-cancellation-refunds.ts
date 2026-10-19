import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { fileRefundEvidenceReview } from './file-refund-evidence-review';
import { holdPaystackRefundForReview } from './hold-paystack-refund-for-review';
import { isDeterministicRefundError } from './is-deterministic-paystack-refund-error';
import type { RefundRow } from './paystack-cancellation-refund-row';
import { reconcilePaystackCancellationRefund } from './reconcile-paystack-cancellation-refund';
import {
  NO_RECONCILE_DEADLINE,
  shouldYieldReconcileWorker,
} from './reconcile-worker-deadline';

export async function reconcilePendingPaystackCancellationRefunds(
  supabase: SupabaseClient,
  limit = 25,
  deadlineMs: number = NO_RECONCILE_DEADLINE
): Promise<{ checked: number; failed: number }> {
  // Candidate selection runs inside the database: PostgREST cannot
  // express the normalized gateway predicate legacy rows require
  // (` Paystack ` must match), and a loose prefilter would both
  // discard the partial candidate index and let corrupt rows occupy
  // the bounded batch before exact filtering.
  const { data, error } = await supabase.rpc(
    'select_pending_paystack_cancellation_refund_candidates_v1',
    { p_limit: limit }
  );
  if (error) throw new Error('pending_refund_lookup_failed');
  let failed = 0;
  let checked = 0;
  for (const refund of data ?? []) {
    // Stop before the pass deadline so flushRefunds and the settlement
    // sweep keep their share of the cron budget instead of timing out.
    if (shouldYieldReconcileWorker(deadlineMs)) break;
    checked++;
    try {
      await reconcilePaystackCancellationRefund(supabase, refund as RefundRow);
    } catch (reason) {
      failed++;
      logger.warn({
        message: 'Paystack cancellation refund check requires another attempt',
        refundId: refund.id,
        orderId: refund.order_id,
        reason: reason instanceof Error ? reason.message : 'unknown',
      });
      // Rotate an unavailable or mismatched provider row so it cannot starve
      // every newer pending refund in this bounded cron batch.
      const { error: rotationError } = await supabase
        .from('transactions')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', refund.id)
        .in('status', ['refund_pending', 'pending']);
      if (rotationError) throw new Error('pending_refund_rotation_failed');
      if (isDeterministicRefundError(reason)) {
        await fileRefundEvidenceReview(
          supabase,
          refund as RefundRow,
          reason.message
        );
        await holdPaystackRefundForReview(supabase, refund.id, reason.message);
      }
    }
  }
  return { checked, failed };
}
