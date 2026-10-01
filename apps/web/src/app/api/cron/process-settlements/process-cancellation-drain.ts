import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import {
  cancellationDrainDeadlineMs,
  cancellationEmailDrainDeadlineMs,
} from '@/lib/orders/cancellation-drain-deadline';
import { cancellationSideEffectDrainLimit } from '@/lib/orders/cancellation-side-effect-drain-limit';
import { drainFailedOrderCancellationSideEffects } from '@/lib/orders/drain-failed-order-cancellation-side-effects';
import type { MerchantRefundPushSender } from '@/lib/payments/drain-paystack-refund-notifications';
import { drainPaystackRefundNotifications } from '@/lib/payments/drain-paystack-refund-notifications';
import { notificationDrainDeadlineMs } from '@/lib/payments/notification-drain-deadline';
import { notificationDrainLimit } from '@/lib/payments/notification-drain-limit';
import { reconcileCompletedPaystackCancellationRefunds } from '@/lib/payments/reconcile-completed-paystack-cancellation-refunds';
import { reconcilePendingPaystackCancellationRefunds } from '@/lib/payments/reconcile-pending-paystack-cancellation-refunds';
import { reconcileWorkerDeadlineMs } from '@/lib/payments/reconcile-worker-deadline';
import { sweepPaystackRefundRecoveryWatches } from '@/lib/payments/sweep-paystack-refund-recovery-watches';
import type { createServiceClient } from '@/lib/supabase/service';
import type { sendEmail } from '@/lib/zeptomail';

type ServiceClient = ReturnType<typeof createServiceClient>;

/**
 * Run the cancellation/refund worker batch: reconcile pending and completed
 * Paystack cancellation refunds plus the refund-recovery watch sweep
 * first, then retry failed cancellation side effects against the
 * settled refund state within the remaining cron budget, then drain
 * refund notifications within what is left after that.
 * The side-effect drain must observe
 * completed refunds: running it in parallel lets it read a refund as
 * nonterminal, then file a preflight review and record delivery_uncertain
 * after the pending-refund worker already completed it. Workers report
 * per-row failure counts instead of throwing, so both rejections and
 * reported failures surface as a 503. Dead-lettered notifications count
 * as failures too: a 200 with exhausted rows would present unreconciled
 * money as success and never page operations.
 */
export async function processCancellationDrain(
  supabase: ServiceClient,
  sendCancellationEmail: typeof sendEmail,
  sendMerchantPush: MerchantRefundPushSender
) {
  const workersStartedAt = Date.now();
  // Bound the parallel reconcile phase so the serial drains behind it keep
  // a guaranteed share of the invocation instead of computing zero limits.
  const workerDeadlineMs = reconcileWorkerDeadlineMs(workersStartedAt);
  const [refundResult, legacyRefundResult, watchSweepResult] =
    await Promise.allSettled([
      reconcilePendingPaystackCancellationRefunds(
        supabase,
        25,
        workerDeadlineMs
      ),
      reconcileCompletedPaystackCancellationRefunds(
        supabase,
        25,
        workerDeadlineMs
      ),
      // Backstop for the refund-recovery watch handoff: re-drive
      // watches completions outside the charge RPC leave behind.
      sweepPaystackRefundRecoveryWatches(supabase, 25, workerDeadlineMs),
    ]);
  // Budget the serial side-effect drain from the remaining invocation
  // time: an aborted step strands its row as claimed, which the next
  // drain converts to permanently non-retryable delivery_uncertain.
  // Skipped rows stay failed for the next invocation.
  const sideEffectLimit = cancellationSideEffectDrainLimit(
    Date.now() - workersStartedAt
  );
  if (sideEffectLimit <= 0) {
    logger.warn({
      message: 'Skipping cancellation side-effect drain: cron budget exhausted',
      elapsedMs: Date.now() - workersStartedAt,
    });
  }
  const [cancellationResult] = await Promise.allSettled([
    drainFailedOrderCancellationSideEffects({
      deadlineMs: cancellationDrainDeadlineMs(workersStartedAt),
      // Emails admit against their own cutoff: the 90s side-effect
      // deadline leaves no 48s sender budget after a full reconcile
      // phase, excluding every customer email on each backlog run.
      emailDeadlineMs: cancellationEmailDrainDeadlineMs(workersStartedAt),
      limit: sideEffectLimit,
      sendCancellationEmail,
      supabase,
    }),
  ]);
  // Budget the serial drain from the remaining invocation time: an
  // aborted send strands its notification as processing, which becomes
  // permanently non-retryable delivery_uncertain. Skipped rows stay
  // pending/failed for the next invocation.
  const drainLimit = notificationDrainLimit(Date.now() - workersStartedAt);
  if (drainLimit <= 0) {
    logger.warn({
      message: 'Skipping refund notification drain: cron budget exhausted',
      elapsedMs: Date.now() - workersStartedAt,
    });
  }
  const notificationResult = await Promise.allSettled([
    drainPaystackRefundNotifications(
      supabase,
      sendCancellationEmail,
      drainLimit,
      sendMerchantPush,
      notificationDrainDeadlineMs(workersStartedAt)
    ),
  ]);
  // The workers fulfill with per-row failure counts instead of throwing,
  // so a rejection-only check would report persistent outages as success.
  const cancellationFailures =
    cancellationResult.status === 'fulfilled'
      ? cancellationResult.value.failed.length
      : 0;
  const refundFailures =
    refundResult.status === 'fulfilled' ? refundResult.value.failed : 0;
  const legacyRefundFailures =
    legacyRefundResult.status === 'fulfilled'
      ? legacyRefundResult.value.failed
      : 0;
  const watchSweepFailures =
    watchSweepResult.status === 'fulfilled' ? watchSweepResult.value.failed : 0;
  const notificationFailures =
    notificationResult[0].status === 'fulfilled'
      ? notificationResult[0].value.failed
      : 0;
  const notificationExhausted =
    notificationResult[0].status === 'fulfilled'
      ? notificationResult[0].value.exhausted
      : 0;
  if (
    cancellationResult.status === 'rejected' ||
    refundResult.status === 'rejected' ||
    legacyRefundResult.status === 'rejected' ||
    watchSweepResult.status === 'rejected' ||
    notificationResult[0].status === 'rejected' ||
    cancellationFailures > 0 ||
    refundFailures > 0 ||
    legacyRefundFailures > 0 ||
    watchSweepFailures > 0 ||
    notificationFailures > 0 ||
    notificationExhausted > 0
  ) {
    logger.error({
      message: 'Cancellation and refund background work partially failed',
      cancellationFailed:
        cancellationResult.status === 'rejected' || cancellationFailures > 0,
      refundFailed: refundResult.status === 'rejected' || refundFailures > 0,
      legacyRefundFailed:
        legacyRefundResult.status === 'rejected' || legacyRefundFailures > 0,
      watchSweepFailed:
        watchSweepResult.status === 'rejected' || watchSweepFailures > 0,
      notificationFailed:
        notificationResult[0].status === 'rejected' ||
        notificationFailures > 0 ||
        notificationExhausted > 0,
      notificationExhausted,
    });
    return NextResponse.json(
      { error: 'Cancellation and refund background work incomplete' },
      { status: 503 }
    );
  }
  return NextResponse.json({
    success: true,
    cancellationSideEffectDrain: cancellationResult.value,
    paystackRefunds: refundResult.value,
    legacyPaystackRefunds: legacyRefundResult.value,
    paystackRefundWatchSweep: watchSweepResult.value,
    paystackRefundNotifications: notificationResult[0].value,
  });
}
