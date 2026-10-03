import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { assertRefundNotificationSendTime } from '@/lib/payments/assert-refund-notification-send-time';
import { awaitRefundNotificationDeadline } from '@/lib/payments/await-refund-notification-deadline';
import {
  clearDuplicateCaptureReviewPending,
  DUPLICATE_CAPTURE_REVIEW_PENDING_KEY,
  setDuplicateCaptureReviewPending,
} from '@/lib/payments/duplicate-capture-review-pending';
import { extractDuplicateCaptureEvidence } from '@/lib/payments/extract-duplicate-capture-evidence';
import { fileDuplicateCaptureFallbackReview } from '@/lib/payments/file-duplicate-capture-fallback-review';
import { fileDuplicatePaymentCapture } from '@/lib/payments/file-duplicate-payment-capture';
import type { finalizeOrderGatewayPayment } from '@/lib/payments/finalize-order-gateway-payment';
import type {
  WedgedCandidate,
  WedgedOrderSweepSummary,
} from '@/lib/payments/reconcile-wedged-gateway-orders.types';
import type { stampWedgeResolution } from '@/lib/payments/retire-wedge-with-review';
import type {
  GatewayChargeVerification,
  HealableGateway,
} from '@/lib/payments/verify-gateway-charge';
import { zeptomailSendAdmissionBudgetMs } from '@/lib/zeptomail-send-budget';

type VerifiedCharge = Extract<GatewayChargeVerification, { ok: true }>;

// One attempt per sender: pass 1's 90s incremental share cannot fit
// the default four-attempt loop, and the paid side-effect queue
// retries failures.
const VERIFIED_WEDGE_EMAIL_ATTEMPTS = 1;

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
  finalizePayment,
  scheduleAfter,
  stampResolution,
  summary,
  supabase,
  verification,
}: {
  candidate: Omit<WedgedCandidate, 'gateway' | 'gateway_reference'> & {
    gateway: HealableGateway;
    gateway_reference: string;
  };
  deadlineMs?: number;
  finalizePayment: typeof finalizeOrderGatewayPayment;
  scheduleAfter: (task: () => Promise<void>) => void;
  stampResolution: typeof stampWedgeResolution;
  summary: WedgedOrderSweepSummary;
  supabase: SupabaseClient;
  verification: VerifiedCharge;
}): Promise<'finalized' | 'stop'> {
  // This path runs in pass 1, whose 90s incremental share can never
  // fit the default four-attempt sender budget: admit on a single
  // attempt per sender instead, and pass the same cap into finalize
  // so the send loop actually fits. A failed send retries through the
  // paid side-effect queue on a later pass. Rows we never start stay
  // unstamped for the next sweep.
  try {
    assertRefundNotificationSendTime(
      deadlineMs,
      zeptomailSendAdmissionBudgetMs(VERIFIED_WEDGE_EMAIL_ATTEMPTS)
    );
  } catch {
    logger.info({
      message: 'Stopping wedged-order sweep before finalize budget runs out',
      transactionId: candidate.id,
    });
    return 'stop';
  }
  // File the duplicate review for an extra capture on an already-paid
  // order. Shared by fresh captures and filing-only retries: evidence
  // comes from the verification response — never re-scaled from the
  // normalized amount — so the review carries the gateway's own
  // charge total, charge id, and status vocabulary, falling back to
  // the verified gateway reference when the response omits the id.
  // The row is already completed, so the main sweep queries reselect
  // nothing: persist the filing-only retry marker BEFORE attempting
  // the filings (a marker written after both filings fail is lost in
  // the same outage that failed them) and clear it once the evidence
  // is durable. A failed clear only reselects a reviewed row whose
  // refiling dedupes.
  const resolveDuplicateCapture = async (): Promise<void> => {
    const responseEvidence = extractDuplicateCaptureEvidence(
      candidate.gateway,
      verification.response,
      candidate.gateway_reference
    );
    if (!responseEvidence) {
      summary.failed.push({
        reason: 'duplicate_capture_evidence_invalid',
        transactionId: candidate.id,
      });
      return;
    }
    const markerSet = await setDuplicateCaptureReviewPending(
      supabase,
      candidate.id
    );
    const duplicateEvidence = {
      gateway: candidate.gateway,
      providerCurrency: verification.currency ?? candidate.currency ?? 'NGN',
      ...responseEvidence,
    };
    const filed = await fileDuplicatePaymentCapture({
      attempt: {
        gateway_reference: candidate.gateway_reference,
        id: candidate.id,
        merchant_id: candidate.merchant_id,
        metadata: candidate.metadata,
        order_id: candidate.order_id,
      },
      evidence: duplicateEvidence,
      supabase,
    });
    if (filed) {
      summary.reviewsFiled.push({
        orderId: candidate.order_id,
        transactionId: candidate.id,
      });
      await stampResolution(supabase, candidate, 'duplicate_capture_reviewed');
      await clearDuplicateCaptureReviewPending(supabase, candidate.id);
      return;
    }
    const fallbackFiled = await fileDuplicateCaptureFallbackReview({
      attempt: {
        gateway_reference: candidate.gateway_reference,
        id: candidate.id,
        merchant_id: candidate.merchant_id,
        order_id: candidate.order_id,
      },
      evidence: duplicateEvidence,
      supabase,
    });
    if (fallbackFiled) {
      summary.reviewsFiled.push({
        orderId: candidate.order_id,
        transactionId: candidate.id,
      });
      await stampResolution(supabase, candidate, 'duplicate_capture_reviewed');
      await clearDuplicateCaptureReviewPending(supabase, candidate.id);
      return;
    }
    // Both filings failed: without the marker the completed row is
    // invisible to every sweep, so require it durably before
    // returning. A filing-only retry already carries one; otherwise
    // retry the set once for a transient blip. If the marker still
    // cannot be confirmed, throw instead of stranding the evidence
    // silently — the sweep records the candidate failure loudly with
    // the transaction attached.
    const marked =
      candidate.metadata?.[DUPLICATE_CAPTURE_REVIEW_PENDING_KEY] === true ||
      markerSet ||
      (await setDuplicateCaptureReviewPending(supabase, candidate.id));
    if (!marked) {
      throw new Error('duplicate_capture_retry_marker_failed');
    }
    summary.failed.push({
      reason: 'duplicate_capture_review_failed',
      transactionId: candidate.id,
    });
  };
  if (candidate.metadata?.[DUPLICATE_CAPTURE_REVIEW_PENDING_KEY] === true) {
    // Filing-only retry: the row already completed on an earlier tick
    // whose duplicate filings both failed. Re-running the finalizer
    // would re-settle captured funds; only the review is still owed.
    await resolveDuplicateCapture();
    return 'finalized';
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
    finalizePayment({
      actor: 'cron:reconcile-gateway-paid-orders',
      emailMaxAttemptsPerSender: VERIFIED_WEDGE_EMAIL_ATTEMPTS,
      // Match the signal's 10s buffer: the platform-sender fallback
      // declines unless its own attempt fits before the cutoff.
      ...(deadlineMs !== undefined && {
        fallbackDeadlineMs: deadlineMs - 10_000,
      }),
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
      // Preserve the pending-candidate signal: forcing false loses the
      // only fresh-capture evidence when another payment won the order
      // race on a legacy order with no outbox rows, misclassifying real
      // captured funds as a legacy replay. A concurrent webhook may
      // still complete this row first, but that same-transaction replay
      // is distinguished downstream by the outbox payer evidence, not
      // by dropping the signal here.
      wonTransactionFlip: candidate.status === 'pending',
    }),
    deadlineMs
  );

  if (outcome.kind === 'completed') {
    if (outcome.capturedOnPaidOrder) {
      // Another transaction paid the order after the wedge query: this
      // capture is extra money, so classify from the atomic completion
      // result and file the duplicate review used by the
      // abandoned-attempt path instead of recording a heal.
      await resolveDuplicateCapture();
      return 'finalized';
    }
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
    await stampResolution(supabase, candidate, outcome.kind);
  } else {
    summary.failed.push({
      reason: outcome.kind,
      transactionId: candidate.id,
    });
  }
  return 'finalized';
}
