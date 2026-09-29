import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { assertRefundNotificationSendTime } from '@/lib/payments/assert-refund-notification-send-time';
import { awaitRefundNotificationDeadline } from '@/lib/payments/await-refund-notification-deadline';
import { extractDuplicateCaptureEvidence } from '@/lib/payments/extract-duplicate-capture-evidence';
import { fileDuplicatePaymentCapture } from '@/lib/payments/file-duplicate-payment-capture';
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
import { zeptomailSendAdmissionBudgetMs } from '@/lib/zeptomail';

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
  // Reserve the full paid-email retry budget before starting finalize:
  // verification may have consumed the pass, and the default 20s check
  // would admit a pass too short for the uncapped four-attempt sender
  // loop — the finalize signal would then abort mid-send and strand the
  // step delivery_uncertain instead of retrying next sweep. Rows we
  // never start stay unstamped for the next sweep.
  try {
    assertRefundNotificationSendTime(
      deadlineMs,
      zeptomailSendAdmissionBudgetMs()
    );
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
      // abandoned-attempt path instead of recording a heal. Evidence
      // comes from the verification response — never re-scaled from the
      // normalized amount — so the review carries the gateway's own
      // charge total, charge id, and status vocabulary.
      const responseEvidence = extractDuplicateCaptureEvidence(
        candidate.gateway,
        verification.response
      );
      if (!responseEvidence) {
        summary.failed.push({
          reason: 'duplicate_capture_evidence_invalid',
          transactionId: candidate.id,
        });
        return 'finalized';
      }
      const filed = await fileDuplicatePaymentCapture({
        attempt: {
          gateway_reference: candidate.gateway_reference,
          id: candidate.id,
          merchant_id: candidate.merchant_id,
          metadata: candidate.metadata,
          order_id: candidate.order_id,
        },
        evidence: {
          gateway: candidate.gateway,
          providerCurrency:
            verification.currency ?? candidate.currency ?? 'NGN',
          ...responseEvidence,
        },
        supabase,
      });
      if (filed) {
        summary.reviewsFiled.push({
          orderId: candidate.order_id,
          transactionId: candidate.id,
        });
        await stampWedgeResolution(
          supabase,
          candidate,
          'duplicate_capture_reviewed'
        );
        return 'finalized';
      }
      summary.failed.push({
        reason: 'duplicate_capture_review_failed',
        transactionId: candidate.id,
      });
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
    await stampWedgeResolution(supabase, candidate, outcome.kind);
  } else {
    summary.failed.push({
      reason: outcome.kind,
      transactionId: candidate.id,
    });
  }
  return 'finalized';
}
