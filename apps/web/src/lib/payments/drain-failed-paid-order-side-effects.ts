import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import type { finalizeOrderGatewayPayment } from '@/lib/payments/finalize-order-gateway-payment';
import {
  PAID_ORDER_SIDE_EFFECT_ATTEMPT_CAP,
  PERMANENT_PAID_ORDER_SIDE_EFFECT_ERRORS,
} from '@/lib/payments/paid-order-side-effect-retry-policy';
import { recoverStrandedPaidOrderSideEffects } from '@/lib/payments/recover-stranded-paid-order-side-effects';
import { REPLAYABLE_PAID_ORDER_SIDE_EFFECT_STEPS } from '@/lib/payments/replayable-paid-order-side-effect-steps';
import { retireTerminalSideEffectDrain } from '@/lib/payments/retire-terminal-side-effect-drain';
import type { retireWedgeWithReview } from '@/lib/payments/retire-wedge-with-review';
import {
  buildJuicywayVerificationContext,
  isHealableGateway,
  isTerminalGatewayVerificationReason,
  verifyGatewayCharge,
} from '@/lib/payments/verify-gateway-charge';

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

type DrainCandidateRow = {
  order_id: string;
  transaction_id: string | null;
  transactions: {
    id: string;
    created_at: string;
    order_id: string | null;
    merchant_id: string;
    amount: number | string | null;
    platform_fee: number | null;
    gateway: string;
    gateway_reference: string | null;
    gateway_response: Record<string, unknown> | null;
    metadata: Record<string, unknown> | null;
  };
};

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
    try {
      const txn = row.transactions;
      const gateway = txn.gateway;
      if (!isHealableGateway(gateway)) {
        summary.skipped.push({ orderId, reason: 'unhealable_gateway' });
        continue;
      }
      if (!txn.gateway_reference) {
        await retireTerminalSideEffectDrain({
          fileWedgeReview,
          orderId,
          reason:
            'Paid-order side-effect drain found a completed transaction with no gateway reference; manual reconciliation required',
          resolution: 'missing_gateway_reference',
          supabase,
          transaction: {
            gateway,
            gateway_reference: null,
            id: txn.id,
            metadata: txn.metadata,
            order_id: orderId,
          },
        });
        summary.skipped.push({ orderId, reason: 'missing_gateway_reference' });
        continue;
      }

      let gatewayResponse = txn.gateway_response;
      if (!gatewayResponse) {
        // Bound the in-flight provider read to the remaining pass share so
        // a hung verification cannot overrun the route budget. Aborts
        // surface as transient-unavailable and retry next run.
        const verifyRemaining =
          deadlineMs === undefined ? undefined : deadlineMs - Date.now();
        if (verifyRemaining !== undefined && verifyRemaining <= 0) {
          logger.info({
            message: 'Stopping paid side-effect drain at pass deadline',
            orderId,
          });
          break;
        }
        const verifySignal =
          verifyRemaining === undefined
            ? undefined
            : AbortSignal.timeout(verifyRemaining);
        const verification =
          gateway === 'juicyway'
            ? await verifyGatewayCharge(
                gateway,
                txn.gateway_reference,
                buildJuicywayVerificationContext(txn.metadata, txn.created_at),
                verifySignal
              )
            : await verifyGatewayCharge(
                gateway,
                txn.gateway_reference,
                undefined,
                verifySignal
              );
        if (!verification.ok) {
          if (isTerminalGatewayVerificationReason(verification.reason)) {
            await retireTerminalSideEffectDrain({
              fileWedgeReview,
              orderId,
              reason: `Paid-order side-effect drain: ${gateway} could not safely confirm reference ${txn.gateway_reference} (${verification.reason}${verification.gatewayStatus ? `: ${verification.gatewayStatus}` : ''}); manual reconciliation required`,
              resolution:
                verification.reason === 'gateway_status_not_success'
                  ? 'gateway_verification_negative'
                  : verification.reason,
              supabase,
              transaction: {
                gateway,
                gateway_reference: txn.gateway_reference,
                id: txn.id,
                metadata: txn.metadata,
                order_id: orderId,
              },
            });
          }
          summary.skipped.push({ orderId, reason: verification.reason });
          continue;
        }
        gatewayResponse = verification.response;
      }

      const outcome = await finalizePayment({
        actor: 'cron:reconcile-gateway-paid-orders:drain',
        gateway,
        gatewayResponse,
        orderId,
        reference: txn.gateway_reference,
        scheduleAfter,
        supabase,
        transaction: {
          amount: txn.amount,
          gateway_reference: txn.gateway_reference,
          id: txn.id,
          merchant_id: txn.merchant_id,
          order_id: txn.order_id,
          platform_fee: txn.platform_fee,
        },
        wonTransactionFlip: false,
      });

      if (outcome.kind === 'completed') {
        logger.warn({
          message: 'Drained failed paid-order side effects via reconcile cron',
          orderId,
          transactionId: txn.id,
        });
        summary.drained.push({ orderId });
      } else {
        summary.failed.push({ orderId, reason: outcome.kind });
      }
    } catch (drainError) {
      logger.error({
        error: drainError,
        message: 'Failed-side-effect drain errored for order',
        orderId,
      });
      summary.failed.push({
        orderId,
        reason:
          drainError instanceof Error ? drainError.message : 'unknown_error',
      });
    }
  }

  return summary;
}
