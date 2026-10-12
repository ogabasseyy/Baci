import type { SupabaseClient } from '@supabase/supabase-js';
import { zeptomailSendAdmissionBudgetMs } from '@/lib/zeptomail-send-budget';
import { assertRefundNotificationSendTime } from './assert-refund-notification-send-time';
import { awaitRefundNotificationDeadline } from './await-refund-notification-deadline';
import {
  DUPLICATE_CAPTURE_REVIEW_PENDING_KEY,
  setDuplicateCaptureReviewPending,
} from './duplicate-capture-review-pending';
import { fileDuplicateCaptureFallbackReview } from './file-duplicate-capture-fallback-review';
import { fileDuplicatePaymentCapture } from './file-duplicate-payment-capture';
import type { finalizeOrderGatewayPayment } from './finalize-order-gateway-payment';
import { gatePartiallyPaidAbandonedCapture } from './gate-partially-paid-abandoned-capture';

// One attempt per sender: pass 0's 90s share cannot fit the default
// four-attempt loop, and the paid side-effect queue retries failures.
const PARTIAL_CAPTURE_EMAIL_ATTEMPTS = 1;

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
    // No gateway predicate: the id/order/merchant/reference/status
    // filters already bind the row, and the sweep normalizes legacy
    // gateway spellings (` Paystack `) an exact match would miss.
    const { data: admitted, error: admitError } = await supabase
      .from('transactions')
      .update({ status: 'pending', updated_at: new Date().toISOString() })
      .eq('id', attempt.id)
      .eq('order_id', attempt.order_id)
      .eq('merchant_id', attempt.merchant_id)
      .eq('transaction_type', 'payment')
      .eq('gateway_reference', attempt.gateway_reference)
      .eq('status', 'processing')
      .select('id');
    if (admitError) summary.failed = true;
    if (admitError || admitted?.length !== 1) {
      await hold('changed_concurrently');
      return;
    }
  }
  // This path runs in pass 0, whose 90s share can never fit the
  // default four-attempt sender budget: admit on a single attempt per
  // sender instead, and pass the same cap into finalize so the send
  // loop actually fits. A failed send retries through the paid
  // side-effect queue on a later pass. The held row retries without
  // failing this one.
  try {
    assertRefundNotificationSendTime(
      deadlineMs,
      zeptomailSendAdmissionBudgetMs(PARTIAL_CAPTURE_EMAIL_ATTEMPTS)
    );
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
  if (gate.status === 'done') return;
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
        emailMaxAttemptsPerSender: PARTIAL_CAPTURE_EMAIL_ATTEMPTS,
        // Serialize the gate's exact-balance comparison with
        // completion: the atomic RPC recomputes the outstanding
        // under its order lock and returns BALANCE_CHANGED instead
        // of promoting when a concurrent payment moved it.
        expectedOutstandingMinor: gate.expectedOutstandingMinor,
        // Match the signal's 10s buffer: the platform-sender fallback
        // declines unless its own attempt fits before the cutoff.
        ...(deadlineMs !== undefined && {
          fallbackDeadlineMs: deadlineMs - 10_000,
        }),
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
        // Preserve the pending-capture signal: every row reaching this
        // finalizer is pending (processing rows normalize above), so
        // forcing false loses the only fresh-capture evidence when
        // another payment won the order race on an order with no outbox
        // rows, misclassifying real captured funds as a legacy replay
        // that skips settlement and the duplicate review. A concurrent
        // webhook may still complete this row first, but that
        // same-transaction replay is distinguished downstream by the
        // outbox payer evidence, not by dropping the signal here.
        wonTransactionFlip: true,
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
      const duplicateEvidence = {
        gateway: 'paystack',
        providerAmount: capture.amount,
        providerCurrency: capture.currency,
        providerReference: String(capture.id),
        providerStatus: capture.status,
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
        evidence: duplicateEvidence,
        supabase,
      });
      if (filed) {
        summary.reviewsFiled.push(attempt.id);
        return;
      }
      // finalizePayment already flipped this row to completed, so the
      // status-guarded hold below persists nothing and no sweep
      // reselects it: persist the evidence directly so the captured
      // extra payment keeps its operations review.
      const fallbackFiled = await fileDuplicateCaptureFallbackReview({
        attempt: {
          gateway_reference: attempt.gateway_reference,
          id: attempt.id,
          merchant_id: attempt.merchant_id,
          order_id: attempt.order_id,
        },
        evidence: duplicateEvidence,
        supabase,
      });
      if (fallbackFiled) {
        summary.reviewsFiled.push(attempt.id);
        return;
      }
      // finalizePayment already flipped this row to completed, so the
      // status-guarded hold below persists nothing and no sweep
      // reselects it: require the filing-only retry marker durably,
      // as the wedge-finalization path does. Without it the captured
      // extra payment has neither an operations review nor any future
      // retry path, so throw loudly instead of stranding the
      // evidence — retrying the set once first for a transient blip.
      const marked =
        attempt.metadata?.[DUPLICATE_CAPTURE_REVIEW_PENDING_KEY] === true ||
        (await setDuplicateCaptureReviewPending(supabase, attempt.id)) ||
        (await setDuplicateCaptureReviewPending(supabase, attempt.id));
      if (!marked) {
        throw new Error('duplicate_capture_retry_marker_failed');
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
    ((outcome.error as { error_code?: unknown }).error_code ===
      'TRANSACTION_IN_UNEXPECTED_STATE' ||
      (outcome.error as { error_code?: unknown }).error_code ===
        'BALANCE_CHANGED')
  ) {
    // BALANCE_CHANGED wrote nothing — the transaction stays pending —
    // so the hold persists and the next sweep re-gates on the fresh
    // balance (overpayment duplicates, shortfalls retire, exact
    // matches proceed) instead of promoting into an overcharge.
    await hold('changed_concurrently');
    return;
  }
  summary.failed = true;
  await hold(outcome.kind);
}
