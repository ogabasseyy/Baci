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

const WATCH_RETIREMENT_AGE_MS = 7 * 24 * 60 * 60 * 1000;

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
  // Oldest first: stale watches always redrive before fresh ones, so
  // no watch waits past retirement behind a younger backlog.
  const { data: watches, error: watchError } = await supabase
    .from('paystack_refund_recovery_watch')
    .select('id, paystack_ref, provider_refund_id, created_at, evidence')
    .eq('status', 'open')
    .order('created_at', { ascending: true })
    .limit(limit);
  if (watchError) throw new Error('refund_recovery_watch_lookup_failed');
  const redrivenIds: string[] = [];
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
      logger.warn({
        message: 'Paystack refund recovery watch needs another attempt',
        watchId: watch.id,
        refundId: watch.provider_refund_id,
        reference: watch.paystack_ref,
        error: reason instanceof Error ? reason.message : 'unknown_sweep_error',
      });
    }
  }
  // Retire only redriven watches that recovery left open: a handled
  // watch resolves (or claims) during the redrive and the status
  // filter skips it, while a failed redrive never lands here. The
  // refund webhook was acknowledged when the watch opened, so
  // retiring before this final recovery attempt could strand a
  // completed payment's refund with no durable review.
  if (redrivenIds.length === 0) return summary;
  const { data: retired, error: retireError } = await supabase
    .from('paystack_refund_recovery_watch')
    .update({ status: 'retired' })
    .eq('status', 'open')
    .lt(
      'created_at',
      new Date(Date.now() - WATCH_RETIREMENT_AGE_MS).toISOString()
    )
    .in('id', redrivenIds)
    .select('id');
  if (retireError) throw new Error('refund_recovery_watch_retire_failed');
  summary.retired = (retired ?? []).length;
  return summary;
}
