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
  // Candidate selection runs inside the database: PostgREST cannot
  // express the normalized gateway predicate legacy rows require
  // (` Paystack ` must match), and a loose prefilter would both
  // discard the partial candidate index and let corrupt rows occupy
  // the bounded batch before exact filtering. The RPC returns the
  // finalized contradiction recheck first (weekly per-row cadence
  // with a small per-tick cap so it never crowds the
  // pre-finalization batch), then the pre-finalization batch.
  const finalizedCutoff = new Date(
    Date.now() - FINALIZED_CONTRADICTION_WINDOW_MS
  ).toISOString();
  const { data, error } = await supabase.rpc(
    'select_completed_paystack_cancellation_refund_candidates_v1',
    {
      p_finalized_cutoff: finalizedCutoff,
      p_finalized_limit: FINALIZED_CONTRADICTION_RECHECK_LIMIT,
      p_limit: limit,
    }
  );
  if (error) throw new Error('completed_refund_lookup_failed');

  let failed = 0;
  let checked = 0;
  for (const refund of data ?? []) {
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
        // Rotation matches the row's own terminal state: the sweep also
        // selects failed stamped manuals for recovery polling, and a
        // completed-only guard would zero-row succeed on them — never
        // rotating updated_at, refiling the same review every run, and
        // starving later contradiction checks behind the oldest row.
        // Anything unexpected falls back to completed (zero rows, safe).
        const rotationStatus =
          refund.status === 'failed' ? 'failed' : 'completed';
        if (
          refund.status === 'failed' ||
          !refund.description?.startsWith('Refund for cancelled order #')
        ) {
          // Failed rows keep their classified status and rotate for
          // recheck cadence; demoting would lose the failed signal the
          // transition persists. Legacy rows carry no cancellation
          // description, so the pending worker would never select them
          // after a demote; rotate here instead so this legacy recheck
          // keeps revisiting the row after operations corrects the
          // reviewed evidence.
          const { error: legacyRotationError } = await supabase
            .from('transactions')
            .update({ updated_at: new Date().toISOString() })
            .eq('id', refund.id)
            .eq('status', rotationStatus);
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
        .eq('status', refund.status === 'failed' ? 'failed' : 'completed');
      if (rotationError) throw new Error('completed_refund_rotation_failed');
    }
  }

  return { checked, failed };
}
