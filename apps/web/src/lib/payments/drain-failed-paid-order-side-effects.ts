import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import {
  type DrainCandidateRow,
  drainFailedPaidOrderSideEffectRow,
} from '@/lib/payments/drain-failed-paid-order-side-effect-row';
import type { finalizeOrderGatewayPayment } from '@/lib/payments/finalize-order-gateway-payment';
import {
  PAID_ORDER_SIDE_EFFECT_ATTEMPT_CAP,
  PERMANENT_PAID_ORDER_SIDE_EFFECT_ERRORS,
} from '@/lib/payments/paid-order-side-effect-retry-policy';
import { recoverStrandedPaidOrderSideEffects } from '@/lib/payments/recover-stranded-paid-order-side-effects';
import { REPLAYABLE_PAID_ORDER_SIDE_EFFECT_STEPS } from '@/lib/payments/replayable-paid-order-side-effect-steps';
import type { retireWedgeWithReview } from '@/lib/payments/retire-wedge-with-review';

// Re-run the claim-gated finalizer for failed paid-order side effects.
// Exclude permanent errors to avoid retry loops.

const DEFAULT_LIMIT = 10;
// Comfortably past the claim RPC's 60s takeover window.
const STALE_CLAIM_MINUTES = 15;

export interface FailedSideEffectDrainSummary {
  drained: Array<{ orderId: string }>;
  failed: Array<{ orderId: string; reason: string }>;
  skipped: Array<{ orderId: string; reason: string }>;
  // Rows lifted back below the attempt cap this run so a code fix can drain
  // them; and rows a recent recovery already retried that are still failing.
  recovered: Array<{ orderId: string; step: string }>;
  stranded: Array<{ orderId: string; step: string; error: string | null }>;
}

export async function drainFailedPaidOrderSideEffects({
  supabase,
  scheduleAfter,
  finalizePayment,
  fileWedgeReview,
  limit = DEFAULT_LIMIT,
  deadlineMs,
}: {
  supabase: SupabaseClient;
  scheduleAfter: (task: () => Promise<void>) => void;
  finalizePayment: typeof finalizeOrderGatewayPayment;
  fileWedgeReview: typeof retireWedgeWithReview;
  limit?: number;
  deadlineMs?: number;
}): Promise<FailedSideEffectDrainSummary> {
  const summary: FailedSideEffectDrainSummary = {
    drained: [],
    failed: [],
    recovered: [],
    skipped: [],
    stranded: [],
  };

  // Un-strand any rows stuck at/over the attempt cap BEFORE selecting drain
  // candidates, so a row lifted back below the cap this run is picked up by the
  // failed-row query below (same tick). Best-effort: it never throws.
  const recovery = await recoverStrandedPaidOrderSideEffects({ supabase });
  summary.recovered = recovery.recovered;
  summary.stranded = recovery.stranded;
  if (recovery.recovered.length > 0) {
    logger.warn({
      message:
        'Recovered stranded paid-order side effects for another drain attempt',
      recovered: recovery.recovered,
    });
  }
  if (recovery.stranded.length > 0) {
    logger.error({
      message:
        'Paid-order side effects stranded past the retry cap — classify the error or reset manually',
      stranded: recovery.stranded,
    });
  }

  const DRAIN_SELECT =
    'order_id, transaction_id, transactions!inner(id, created_at, order_id, merchant_id, amount, platform_fee, gateway, gateway_reference, gateway_response, metadata), orders!inner(id, payment_status, cancelled_at)';

  const { data: failedRows, error: lookupError } = await supabase
    .from('payment_side_effects')
    .select(DRAIN_SELECT)
    .eq('status', 'failed')
    .lt('attempts', PAID_ORDER_SIDE_EFFECT_ATTEMPT_CAP)
    .not(
      'error',
      'in',
      `(${PERMANENT_PAID_ORDER_SIDE_EFFECT_ERRORS.join(',')})`
    )
    .in('step', [...REPLAYABLE_PAID_ORDER_SIDE_EFFECT_STEPS])
    .eq('transactions.status', 'completed')
    .eq('orders.payment_status', 'paid')
    .is('orders.cancelled_at', null)
    .limit(limit * 3);

  if (lookupError) {
    throw new Error(`failed_side_effect_lookup_failed: ${lookupError.message}`);
  }

  // A worker that dies between claim_payment_side_effect and
  // markCompleted/markFailed leaves the row 'claimed' forever; the claim
  // RPC's 60s takeover only helps if something re-runs the order. Sweep
  // stale claims too so a crashed verify/webhook run cannot strand its
  // email/settlement steps.
  const staleClaimCutoff = new Date(
    Date.now() - STALE_CLAIM_MINUTES * 60_000
  ).toISOString();
  const { data: staleRows, error: staleLookupError } = await supabase
    .from('payment_side_effects')
    .select(DRAIN_SELECT)
    .eq('status', 'claimed')
    .lt('attempts', PAID_ORDER_SIDE_EFFECT_ATTEMPT_CAP)
    .lt('claimed_at', staleClaimCutoff)
    .in('step', [...REPLAYABLE_PAID_ORDER_SIDE_EFFECT_STEPS])
    .eq('transactions.status', 'completed')
    .eq('orders.payment_status', 'paid')
    .is('orders.cancelled_at', null)
    .limit(limit * 3);

  if (staleLookupError) {
    throw new Error(
      `stale_side_effect_lookup_failed: ${staleLookupError.message}`
    );
  }

  const byOrder = new Map<string, DrainCandidateRow>();
  for (const raw of [...(failedRows ?? []), ...(staleRows ?? [])]) {
    const row = raw as unknown as DrainCandidateRow;
    if (!byOrder.has(row.order_id)) {
      byOrder.set(row.order_id, row);
    }
    if (byOrder.size >= limit) {
      break;
    }
  }

  for (const [orderId, row] of byOrder) {
    // Stop starting orders at the pass deadline: serial side-effect
    // execution can outlast the invocation budget, and unstarted rows
    // stay failed for the next drain.
    if (deadlineMs !== undefined && Date.now() >= deadlineMs) {
      logger.info({
        message: 'Stopping paid side-effect drain at pass deadline',
        orderId,
      });
      break;
    }
    const rowOutcome = await drainFailedPaidOrderSideEffectRow({
      deadlineMs,
      fileWedgeReview,
      finalizePayment,
      orderId,
      row,
      scheduleAfter,
      supabase,
    });
    if (rowOutcome.action === 'stop') break;
    if (rowOutcome.action === 'stop_failed') {
      summary.failed.push({ orderId, reason: rowOutcome.reason });
      break;
    }
    if (rowOutcome.action === 'drained') {
      summary.drained.push({ orderId });
    } else if (rowOutcome.action === 'failed') {
      summary.failed.push({ orderId, reason: rowOutcome.reason });
    } else {
      summary.skipped.push({ orderId, reason: rowOutcome.reason });
    }
  }

  return summary;
}
