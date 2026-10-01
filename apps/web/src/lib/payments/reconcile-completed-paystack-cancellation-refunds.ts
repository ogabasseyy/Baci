import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { fileRefundEvidenceReview } from './file-refund-evidence-review';
import { isDeterministicRefundError } from './is-deterministic-paystack-refund-error';
import { reconcilePaystackCancellationRefund } from './reconcile-paystack-cancellation-refund';
import {
  NO_RECONCILE_DEADLINE,
  shouldYieldReconcileWorker,
} from './reconcile-worker-deadline';

const FINALIZED_CONTRADICTION_WINDOW_MS = 7 * 24 * 60 * 60_000;
const FINALIZED_CONTRADICTION_RECHECK_LIMIT = 5;

/**
 * Recheck legacy completed refund rows before finalizing a cancelled
 * order, plus a bounded contradiction sweep over finalized orders.
 */
export async function reconcileCompletedPaystackCancellationRefunds(
  supabase: SupabaseClient,
  limit = 25,
  deadlineMs: number = NO_RECONCILE_DEADLINE
): Promise<{ checked: number; failed: number }> {
  const select =
    'id, order_id, merchant_id, gateway_reference, amount, currency, description, metadata, status, cancellation_order:orders!transactions_order_id_fkey!inner(payment_status,shipping_status,cancelled_at)';
  const { data, error } = await supabase
    .from('transactions')
    .select(select)
    .eq('transaction_type', 'refund')
    .eq('gateway', 'paystack')
    .eq('status', 'completed')
    // Wedged orders (completed legs never flipped to paid) cancel and verify
    // like paid orders: without 'pending' their completed refunds never reach
    // the transition RPC. The per-row reconcile resolves the linked payment
    // and the RPC admits only funded legs, so unfunded rows still fail
    // deterministically with a review instead of transitioning.
    .in('cancellation_order.payment_status', [
      'paid',
      'partially_paid',
      'pending',
    ])
    .in('cancellation_order.shipping_status', ['cancelled', 'canceled'])
    .not('cancellation_order.cancelled_at', 'is', null)
    .order('updated_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error('completed_refund_lookup_failed');

  // Finalized orders keep a bounded contradiction recheck: a legacy row
  // trusted before verification, or a later contradictory provider
  // verdict whose webhook was missed, would otherwise never reach the
  // transition RPC that detects it. Weekly per-row cadence (verified
  // and rotated rows bump updated_at) with a small per-tick cap keeps
  // the sweep from crowding the pre-finalization batch.
  const finalizedCutoff = new Date(
    Date.now() - FINALIZED_CONTRADICTION_WINDOW_MS
  ).toISOString();
  const { data: finalizedData, error: finalizedError } = await supabase
    .from('transactions')
    .select(select)
    .eq('transaction_type', 'refund')
    .eq('gateway', 'paystack')
    .eq('status', 'completed')
    .eq('cancellation_order.payment_status', 'refunded')
    .in('cancellation_order.shipping_status', ['cancelled', 'canceled'])
    .not('cancellation_order.cancelled_at', 'is', null)
    // Null timestamps are the oldest eligible rows: a bare less-than
    // compares SQL unknown and would exclude a finalized legacy
    // refund from the contradiction sweep forever.
    .or(`updated_at.is.null,updated_at.lt.${finalizedCutoff}`)
    .order('updated_at', { ascending: true })
    .limit(FINALIZED_CONTRADICTION_RECHECK_LIMIT);
  if (finalizedError) throw new Error('completed_refund_lookup_failed');

  let failed = 0;
  let checked = 0;
  // Finalized rows first: the sweep is capped at five, so it costs the
  // pre-finalization batch almost nothing — but trailing it would let a
  // sustained backlog consume the whole row-start window and starve the
  // contradiction recheck indefinitely.
  for (const refund of [...(finalizedData ?? []), ...(data ?? [])]) {
    // Stop before the pass deadline so the settlement sweep keeps its
    // share of the cron budget instead of timing out behind this worker.
    if (shouldYieldReconcileWorker(deadlineMs)) break;
    checked++;
    try {
      await reconcilePaystackCancellationRefund(supabase, refund);
    } catch (reason) {
      failed++;
      logger.warn({
        message: 'Legacy cancellation refund requires another provider check',
        refundId: refund.id,
        reason: reason instanceof Error ? reason.message : 'unknown',
      });
      if (isDeterministicRefundError(reason)) {
        // Evidence that can never verify: file the mismatch for operations,
        // then demote so the pending worker re-tracks the row instead of
        // retrying this completed row forever. Filing first matters: if the
        // review write fails, the row must stay completed so this worker
        // retries it.
        await fileRefundEvidenceReview(supabase, refund, reason.message);
        if (!refund.description?.startsWith('Refund for cancelled order #')) {
          // Legacy rows carry no cancellation description, so the pending
          // worker would never select them after a demote; rotate here
          // instead so this legacy recheck keeps revisiting the row after
          // operations corrects the reviewed evidence.
          const { error: legacyRotationError } = await supabase
            .from('transactions')
            .update({ updated_at: new Date().toISOString() })
            .eq('id', refund.id)
            .eq('status', 'completed');
          if (legacyRotationError)
            throw new Error('completed_refund_rotation_failed');
          continue;
        }
        const { error: demoteError } = await supabase
          .from('transactions')
          .update({
            status: 'refund_pending',
            updated_at: new Date().toISOString(),
          })
          .eq('id', refund.id)
          .eq('status', 'completed');
        if (demoteError) throw new Error('completed_refund_demote_failed');
        continue;
      }
      const { error: rotationError } = await supabase
        .from('transactions')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', refund.id)
        .eq('status', 'completed');
      if (rotationError) throw new Error('completed_refund_rotation_failed');
    }
  }

  return { checked, failed };
}
