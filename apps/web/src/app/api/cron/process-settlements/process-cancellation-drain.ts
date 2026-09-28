import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import {
  cancellationDrainDeadlineMs,
  cancellationSideEffectDrainLimit,
} from '@/lib/orders/cancellation-side-effect-drain-limit';
import { drainFailedOrderCancellationSideEffects } from '@/lib/orders/drain-failed-order-cancellation-side-effects';
import type { MerchantRefundPushSender } from '@/lib/payments/drain-paystack-refund-notifications';
import { drainPaystackRefundNotifications } from '@/lib/payments/drain-paystack-refund-notifications';
import {
  notificationDrainDeadlineMs,
  notificationDrainLimit,
} from '@/lib/payments/notification-drain-limit';
import { reconcileCompletedPaystackCancellationRefunds } from '@/lib/payments/reconcile-completed-paystack-cancellation-refunds';
import { reconcilePendingPaystackCancellationRefunds } from '@/lib/payments/reconcile-pending-paystack-cancellation-refunds';
import type { createServiceClient } from '@/lib/supabase/service';
import type { sendEmail } from '@/lib/zeptomail';

type ServiceClient = ReturnType<typeof createServiceClient>;

/**
 * Run the cancellation/refund worker batch: reconcile pending and completed
 * Paystack cancellation refunds first, then retry failed cancellation side
 * effects against the settled refund state within the remaining cron
 * budget, then drain refund notifications within what is left after that.
 * The side-effect drain must observe
 * completed refunds: running it in parallel lets it read a refund as
 * nonterminal, then file a preflight review and record delivery_uncertain
 * after the pending-refund worker already completed it. Workers report
 * per-row failure counts instead of throwing, so both rejections and
 * reported failures surface as a 503.
 */
export async function processCancellationDrain(
  supabase: ServiceClient,
  sendCancellationEmail: typeof sendEmail,
  sendMerchantPush: MerchantRefundPushSender
) {
  const workersStartedAt = Date.now();
  const [refundResult, legacyRefundResult] = await Promise.allSettled([
    reconcilePendingPaystackCancellationRefunds(supabase),
    reconcileCompletedPaystackCancellationRefunds(supabase),
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
  const notificationFailures =
    notificationResult[0].status === 'fulfilled'
      ? notificationResult[0].value.failed
      : 0;
  if (
    cancellationResult.status === 'rejected' ||
    refundResult.status === 'rejected' ||
    legacyRefundResult.status === 'rejected' ||
    notificationResult[0].status === 'rejected' ||
    cancellationFailures > 0 ||
    refundFailures > 0 ||
    legacyRefundFailures > 0 ||
    notificationFailures > 0
  ) {
    logger.error({
      message: 'Cancellation and refund background work partially failed',
      cancellationFailed:
        cancellationResult.status === 'rejected' || cancellationFailures > 0,
      refundFailed: refundResult.status === 'rejected' || refundFailures > 0,
      legacyRefundFailed:
        legacyRefundResult.status === 'rejected' || legacyRefundFailures > 0,
      notificationFailed:
        notificationResult[0].status === 'rejected' || notificationFailures > 0,
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
    paystackRefundNotifications: notificationResult[0].value,
  });
}
