import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { reconcilePaystackRefundEvent } from './reconcile-paystack-refund-event';
import {
  NO_RECONCILE_DEADLINE,
  shouldYieldReconcileWorker,
} from './reconcile-worker-deadline';
import { recoverUnknownPaystackRefund } from './recover-unknown-paystack-refund';

export interface RefundRecoveryWatchSweepSummary {
  checked: number;
  redriven: number;
  failed: number;
  retired: number;
}

interface OpenWatchRow {
  created_at: string;
  evidence: {
    provider_refund_status?: string;
  } | null;
  id: string;
  paystack_ref: string;
  provider_refund_id: number | null;
}

/**
 * Backstop for the refund-recovery watch handoff. The completion path
 * normally claims watches atomically, but completions outside the
 * charge RPC — and watches whose filing failed — stay open: re-drive
 * recovery for them so a payment that landed after the scan is
 * recorded instead of lingering watched-but-unhandled. Reference-only
 * watches (no refund ID) re-drive through the reference-only path
 * with the watched event verdict. Retirement only follows a
 * successful redrive: a stale watch whose recovery still finds
 * nothing held no payment for a week, so with no payment row the
 * merchant collected nothing locally and there is no order to
 * protect. Failed redrives stay open for the next run. Reports
 * per-row failure counts instead of throwing, like the sibling
 * reconcile workers.
 */
export async function sweepPaystackRefundRecoveryWatches(
  supabase: SupabaseClient,
  limit = 25,
  deadlineMs: number = NO_RECONCILE_DEADLINE
): Promise<RefundRecoveryWatchSweepSummary> {
  const summary: RefundRecoveryWatchSweepSummary = {
    checked: 0,
    redriven: 0,
    failed: 0,
    retired: 0,
  };
  // Least-recently-touched first: failed redrives bump updated_at
  // below so one bad batch rotates behind the backlog instead of
  // pinning the bounded sweep; created_at still gates retirement.
  const { data: watches, error: watchError } = await supabase
    .from('paystack_refund_recovery_watch')
    .select('id, paystack_ref, provider_refund_id, created_at, evidence')
    .eq('status', 'open')
    .order('updated_at', { ascending: true })
    .limit(limit);
  if (watchError) throw new Error('refund_recovery_watch_lookup_failed');
  const redrivenIds: string[] = [];
  const failedIds: string[] = [];
  for (const watch of (watches ?? []) as OpenWatchRow[]) {
    if (shouldYieldReconcileWorker(deadlineMs)) break;
    summary.checked++;
    try {
      if (watch.provider_refund_id === null) {
        const verdict =
          typeof watch.evidence?.provider_refund_status === 'string' &&
          watch.evidence.provider_refund_status.trim() !== ''
            ? watch.evidence.provider_refund_status
            : 'unknown';
        await reconcilePaystackRefundEvent(
          supabase,
          watch.paystack_ref,
          verdict
        );
      } else {
        await recoverUnknownPaystackRefund(
          supabase,
          watch.provider_refund_id,
          watch.paystack_ref
        );
      }
      summary.redriven++;
      redrivenIds.push(watch.id);
    } catch (reason) {
      summary.failed++;
      failedIds.push(watch.id);
      logger.warn({
        message: 'Paystack refund recovery watch needs another attempt',
        watchId: watch.id,
        refundId: watch.provider_refund_id,
        reference: watch.paystack_ref,
        error: reason instanceof Error ? reason.message : 'unknown_sweep_error',
      });
    }
  }
  // Rotate failed watches behind the backlog: without this the same
  // failing rows top every oldest-first batch and newer watches
  // starve. Non-fatal: rows whose bump fails simply retry in place
  // on the next run.
  if (failedIds.length > 0) {
    const { error: rotateError } = await supabase
      .from('paystack_refund_recovery_watch')
      .update({ updated_at: new Date().toISOString() })
      .eq('status', 'open')
      .in('id', failedIds);
    if (rotateError) {
      logger.warn({
        message: 'Paystack refund recovery watch rotation failed',
        error: rotateError.message,
      });
    }
  }
  // Retire only redriven watches that recovery left open: a handled
  // watch resolves (or claims) during the redrive and the RPC skips
  // it, while a failed redrive never lands here. The refund webhook
  // was acknowledged when the watch opened, so retiring before this
  // final recovery attempt could strand a completed payment's refund
  // with no durable review. Retirement runs per watch under the
  // advisory reference lock with a final payment rescan: a bare
  // update would let a payment completing after the redrive scan lose
  // the race, and its completion hook would find the watch already
  // retired with the refund never attached or filed.
  if (redrivenIds.length === 0) return summary;
  const { data: retiredCount, error: retireError } = await supabase.rpc(
    'retire_paystack_refund_recovery_watches_v1',
    { p_watch_ids: redrivenIds }
  );
  if (retireError) throw new Error('refund_recovery_watch_retire_failed');
  summary.retired = retiredCount ?? 0;
  return summary;
}
