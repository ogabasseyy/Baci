import type { SupabaseClient } from '@supabase/supabase-js';
import { assertRefundNotificationSendTime } from './assert-refund-notification-send-time';
import { awaitRefundNotificationDeadline } from './await-refund-notification-deadline';
import { fileDuplicatePaymentCapture } from './file-duplicate-payment-capture';
import type { finalizeOrderGatewayPayment } from './finalize-order-gateway-payment';
import { gatePartiallyPaidAbandonedCapture } from './gate-partially-paid-abandoned-capture';

/**
 * Complete a verified capture on a partially paid order. The balance gate
 * runs first: invoice legs record strict underpayments through the atomic
 * partial-payment RPC (never promoting the order) and file overpayments
 * as duplicates; only an exact-balance capture reaches the atomic order
 * finalizer below. Mismatched captures never reach this path: they are
 * filed with their evidence instead.
 */
export async function finalizePartiallyPaidAbandonedAttempt({
  attempt,
  deadlineMs,
  finalizePayment,
  hold,
  providerData,
  scheduleAfter,
  summary,
  supabase,
}: {
  attempt: {
    amount: number;
    gateway_reference: string;
    id: string;
    merchant_id: string;
    metadata?: Record<string, unknown> | null;
    order_id: string;
    platform_fee: number | null;
    status: 'pending' | 'processing';
  };
  deadlineMs?: number;
  finalizePayment: typeof finalizeOrderGatewayPayment;
  hold: (reason: string) => Promise<void>;
  providerData: Record<string, unknown>;
  scheduleAfter: (task: () => Promise<void>) => void;
  summary: { completed: string[]; failed: boolean; reviewsFiled: string[] };
  supabase: SupabaseClient;
}): Promise<void> {
  if (attempt.status === 'processing') {
    // The completion RPC admits only pending/completed rows, so atomically
    // normalize a wedged processing row to pending first. Zero matched rows
    // means a concurrent webhook completed it meanwhile — a genuine
    // concurrent change, not a wedged row.
    const { data: admitted, error: admitError } = await supabase
      .from('transactions')
      .update({ status: 'pending', updated_at: new Date().toISOString() })
      .eq('id', attempt.id)
      .eq('order_id', attempt.order_id)
      .eq('merchant_id', attempt.merchant_id)
      .eq('transaction_type', 'payment')
      .eq('gateway', 'paystack')
      .eq('gateway_reference', attempt.gateway_reference)
      .eq('status', 'processing')
      .select('id');
    if (admitError) summary.failed = true;
    if (admitError || admitted?.length !== 1) {
      await hold('changed_concurrently');
      return;
    }
  }
  // Reserve budget before starting finalize: verification may have
  // consumed the pass, and finalize would spend the paid-email retry
  // budget past the deadline, starving the later passes. The held row
  // retries on the next sweep without failing this one.
  try {
    assertRefundNotificationSendTime(deadlineMs);
  } catch {
    await hold('finalize_budget_exhausted');
    return;
  }
  // The generic finalizer promotes any non-paid order to paid, so an
  // underpayment would trigger full paid side effects. The gate records
  // or files partial outcomes first and only exact-balance captures
  // proceed. It runs after the processing normalization above because
  // the partial-payment RPC admits only pending rows.
  const gate = await gatePartiallyPaidAbandonedCapture({
    attempt,
    hold,
    providerData,
    summary,
    supabase,
  });
  if (gate === 'done') return;
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
  let outcome: Awaited<ReturnType<typeof finalizePayment>>;
  try {
    outcome = await awaitRefundNotificationDeadline(
      finalizePayment({
        actor: 'cron:reconcile-gateway-paid-orders',
        gateway: 'paystack',
        gatewayResponse: providerData,
        orderId: attempt.order_id,
        reference: attempt.gateway_reference,
        scheduleAfter,
        signal: finalizeSignal,
        supabase,
        transaction: {
          amount: attempt.amount,
          gateway_reference: attempt.gateway_reference,
          id: attempt.id,
          merchant_id: attempt.merchant_id,
          order_id: attempt.order_id,
          platform_fee: attempt.platform_fee,
        },
        // The cron never claims the flip: a concurrent webhook may complete
        // this row first, so classification must come from the completion
        // RPC result (order_updated/already_completed) rather than the
        // stale candidate snapshot. Passing true would misclassify such a
        // replay as a new capture on an already-paid order.
        wonTransactionFlip: false,
      }),
      deadlineMs
    );
  } catch (finalizeError) {
    // The finalize deadline race fired: the finalize may still be running,
    // so hold the row for the next sweep instead of failing it.
    // finalizePayment never throws this message itself — it is pinned by
    // the deadline helper's own suite.
    if (
      finalizeError instanceof Error &&
      finalizeError.message === 'refund_notification_delivery_deadline'
    ) {
      await hold('finalize_deadline_exceeded');
      return;
    }
    throw finalizeError;
  }
  if (outcome.kind === 'completed') {
    if (outcome.capturedOnPaidOrder) {
      // The order filled before our atomic flip: this capture is extra
      // money, so classify from the completion result — not the stale
      // partially-paid snapshot — and file the possible duplicate charge
      // instead of recording a completion.
      const capture = providerData as unknown as {
        amount: number;
        currency: string;
        id: number;
        reference: string;
        status: string;
      };
      const filed = await fileDuplicatePaymentCapture({
        attempt: {
          gateway_reference: attempt.gateway_reference,
          id: attempt.id,
          merchant_id: attempt.merchant_id,
          // Unread by the filer; the stamp merges database-side so a
          // concurrent completion is never clobbered.
          metadata: null,
          order_id: attempt.order_id,
        },
        evidence: {
          gateway: 'paystack',
          providerAmount: capture.amount,
          providerCurrency: capture.currency,
          providerReference: String(capture.id),
          providerStatus: capture.status,
        },
        supabase,
      });
      if (filed) {
        summary.reviewsFiled.push(attempt.id);
        return;
      }
      summary.failed = true;
      await hold('duplicate_capture_review_failed');
      return;
    }
    summary.completed.push(attempt.id);
    return;
  }
  if (outcome.kind === 'order_cancelled' || outcome.kind === 'order_skipped') {
    summary.reviewsFiled.push(attempt.id);
    return;
  }
  if (
    outcome.kind === 'completion_failed' &&
    typeof outcome.error === 'object' &&
    outcome.error !== null &&
    (outcome.error as { error_code?: unknown }).error_code ===
      'TRANSACTION_IN_UNEXPECTED_STATE'
  ) {
    await hold('changed_concurrently');
    return;
  }
  summary.failed = true;
  await hold(outcome.kind);
}
