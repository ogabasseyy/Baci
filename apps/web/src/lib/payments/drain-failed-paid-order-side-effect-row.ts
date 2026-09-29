import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { assertRefundNotificationSendTime } from '@/lib/payments/assert-refund-notification-send-time';
import { awaitRefundNotificationDeadline } from '@/lib/payments/await-refund-notification-deadline';
import type { finalizeOrderGatewayPayment } from '@/lib/payments/finalize-order-gateway-payment';
import { retireTerminalSideEffectDrain } from '@/lib/payments/retire-terminal-side-effect-drain';
import type { retireWedgeWithReview } from '@/lib/payments/retire-wedge-with-review';
import {
  buildJuicywayVerificationContext,
  isHealableGateway,
  isTerminalGatewayVerificationReason,
  verifyGatewayCharge,
} from '@/lib/payments/verify-gateway-charge';
import { zeptomailSendAdmissionBudgetMs } from '@/lib/zeptomail';

export type DrainCandidateRow = {
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

export type PaidOrderDrainRowOutcome =
  | { action: 'drained' }
  | { action: 'failed'; reason: string }
  | { action: 'skipped'; reason: string }
  // The pass budget is exhausted: the caller must stop the loop (not
  // advance) because later rows have even less budget left. `stop` leaves
  // the row untouched for the next drain; `stop_failed` also records this
  // row as failed.
  | { action: 'stop' }
  | { action: 'stop_failed'; reason: string };

// Verify-then-finalize one failed paid-order side-effect row: re-verify an
// unverified charge with its gateway, refuse to start finalize inside the
// send-time reserve, and race in-flight finalize against the pass
// deadline. Loop control stays with the caller, which translates the
// outcome into summary entries and break/continue.
export async function drainFailedPaidOrderSideEffectRow({
  deadlineMs,
  fileWedgeReview,
  finalizePayment,
  orderId,
  row,
  scheduleAfter,
  supabase,
}: {
  deadlineMs?: number;
  fileWedgeReview: typeof retireWedgeWithReview;
  finalizePayment: typeof finalizeOrderGatewayPayment;
  orderId: string;
  row: DrainCandidateRow;
  scheduleAfter: (task: () => Promise<void>) => void;
  supabase: SupabaseClient;
}): Promise<PaidOrderDrainRowOutcome> {
  try {
    const txn = row.transactions;
    const gateway = txn.gateway;
    if (!isHealableGateway(gateway)) {
      return { action: 'skipped', reason: 'unhealable_gateway' };
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
      return { action: 'skipped', reason: 'missing_gateway_reference' };
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
        return { action: 'stop' };
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
        return { action: 'skipped', reason: verification.reason };
      }
      gatewayResponse = verification.response;
    }

    // Reserve the full paid-email retry budget before starting
    // finalize: the default 20s check would admit a pass too short for
    // the uncapped four-attempt sender loop, and the finalize signal
    // would then abort mid-send into delivery_uncertain — marking the
    // email completed instead of leaving the row failed for the next
    // drain. Rows we never start stay failed for the next drain.
    try {
      assertRefundNotificationSendTime(
        deadlineMs,
        zeptomailSendAdmissionBudgetMs()
      );
    } catch {
      logger.info({
        message:
          'Stopping paid side-effect drain before finalize budget runs out',
        orderId,
      });
      return { action: 'stop' };
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
        actor: 'cron:reconcile-gateway-paid-orders:drain',
        // Match the signal's 10s buffer: the platform-sender fallback
        // declines unless its own attempt fits before the cutoff.
        ...(deadlineMs !== undefined && {
          fallbackDeadlineMs: deadlineMs - 10_000,
        }),
        gateway,
        gatewayResponse,
        orderId,
        reference: txn.gateway_reference,
        scheduleAfter,
        signal: finalizeSignal,
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
      }),
      deadlineMs
    );

    if (outcome.kind === 'completed') {
      logger.warn({
        message: 'Drained failed paid-order side effects via reconcile cron',
        orderId,
        transactionId: txn.id,
      });
      return { action: 'drained' };
    }
    return { action: 'failed', reason: outcome.kind };
  } catch (drainError) {
    // The finalize deadline race fired: the finalize may still be running,
    // so stop the loop instead of overlapping another finalize on an
    // exhausted budget. finalizePayment never throws this message itself —
    // it is pinned by the deadline helper's own suite.
    if (
      drainError instanceof Error &&
      drainError.message === 'refund_notification_delivery_deadline'
    ) {
      logger.info({
        message:
          'Stopping paid side-effect drain: finalize overran its deadline',
        orderId,
      });
      return { action: 'stop_failed', reason: 'finalize_deadline_exceeded' };
    }
    logger.error({
      error: drainError,
      message: 'Failed-side-effect drain errored for order',
      orderId,
    });
    return {
      action: 'failed',
      reason:
        drainError instanceof Error ? drainError.message : 'unknown_error',
    };
  }
}
