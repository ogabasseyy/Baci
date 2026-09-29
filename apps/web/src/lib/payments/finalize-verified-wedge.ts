import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { assertRefundNotificationSendTime } from '@/lib/payments/assert-refund-notification-send-time';
import { awaitRefundNotificationDeadline } from '@/lib/payments/await-refund-notification-deadline';
import { finalizeOrderGatewayPayment } from '@/lib/payments/finalize-order-gateway-payment';
import type {
  WedgedCandidate,
  WedgedOrderSweepSummary,
} from '@/lib/payments/reconcile-wedged-gateway-orders.types';
import { stampWedgeResolution } from '@/lib/payments/retire-wedge-with-review';
import type {
  GatewayChargeVerification,
  HealableGateway,
} from '@/lib/payments/verify-gateway-charge';

type VerifiedCharge = Extract<GatewayChargeVerification, { ok: true }>;

/**
 * Finalize a provider-verified wedge through the atomic order finalizer.
 * Declines to start without enough pass budget left (`stop`: later rows
 * have even less, so the caller breaks); otherwise bounds the finalize
 * itself to the remaining deadline and records the outcome. Loop control
 * stays with the caller.
 */
export async function finalizeVerifiedWedge({
  candidate,
  deadlineMs,
  scheduleAfter,
  summary,
  supabase,
  verification,
}: {
  candidate: Omit<WedgedCandidate, 'gateway' | 'gateway_reference'> & {
    gateway: HealableGateway;
    gateway_reference: string;
  };
  deadlineMs?: number;
  scheduleAfter: (task: () => Promise<void>) => void;
  summary: WedgedOrderSweepSummary;
  supabase: SupabaseClient;
  verification: VerifiedCharge;
}): Promise<'finalized' | 'stop'> {
  // Reserve budget before starting finalize: verification may have
  // consumed the pass, and finalize would spend the paid-email retry
  // budget past the deadline, starving the failed-side-effect pass.
  // Rows we never start stay unstamped for the next sweep.
  try {
    assertRefundNotificationSendTime(deadlineMs);
  } catch {
    logger.info({
      message: 'Stopping wedged-order sweep before finalize budget runs out',
      transactionId: candidate.id,
    });
    return 'stop';
  }
  // Cancel the finalize itself — not just this wait — when the pass
  // budget runs out: the signal aborts the in-flight paid-email send
  // (ZeptoMail treats aborts as terminal, never retried), so an
  // overrunning finalize fails its step instead of delivering email
  // after the caller gave up. It shares the race's 10s buffer so the
  // orphan has time to persist its own failure.
  const finalizeSignal =
    deadlineMs === undefined
      ? undefined
      : AbortSignal.timeout(Math.max(1, deadlineMs - Date.now() - 10_000));
  const outcome = await awaitRefundNotificationDeadline(
    finalizeOrderGatewayPayment({
      actor: 'cron:reconcile-gateway-paid-orders',
      gateway: candidate.gateway,
      gatewayResponse: verification.response,
      orderId: candidate.order_id,
      reference: candidate.gateway_reference,
      scheduleAfter,
      signal: finalizeSignal,
      supabase,
      transaction: {
        amount: candidate.amount,
        gateway_reference: candidate.gateway_reference,
        id: candidate.id,
        merchant_id: candidate.merchant_id,
        order_id: candidate.order_id,
        platform_fee: candidate.platform_fee,
      },
      // The cron never claims the flip: a concurrent webhook may complete
      // this row first, so classification must come from the completion
      // RPC result (order_updated/already_completed) rather than the
      // stale candidate snapshot. Passing true would misclassify such a
      // replay as a new capture on an already-paid order and skip the
      // normal side effects without recovery markers.
      wonTransactionFlip: false,
    }),
    deadlineMs
  );

  if (outcome.kind === 'completed') {
    logger.warn({
      healed: outcome.healed,
      message: 'Sweep healed a wedged gateway order payment',
      orderId: candidate.order_id,
      orderNumber: outcome.orderNumber,
      transactionId: candidate.id,
    });
    summary.healed.push({
      orderId: candidate.order_id,
      orderNumber: outcome.orderNumber,
    });
  } else if (
    outcome.kind === 'order_cancelled' ||
    outcome.kind === 'order_skipped'
  ) {
    // The finalizer filed the reconciliation_review row for the captured
    // funds; stamp the transaction so this terminal state is processed
    // exactly once.
    summary.reviewsFiled.push({
      orderId: candidate.order_id,
      transactionId: candidate.id,
    });
    await stampWedgeResolution(supabase, candidate, outcome.kind);
  } else {
    summary.failed.push({
      reason: outcome.kind,
      transactionId: candidate.id,
    });
  }
  return 'finalized';
}
