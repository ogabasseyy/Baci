import { logger } from '@/lib/logger';
import { claimAlert, confirmClaim } from '@/lib/orders/refund-alert-claims';
import { deliverAlert } from '@/lib/orders/refund-alert-delivery';
import type {
  AlertSupabase,
  ChannelOutcome,
  PriorAlertAttempt,
  RefundReviewAlertMerchant,
  RefundReviewAlertOrder,
  RefundReviewAlertSenders,
} from '@/lib/orders/refund-alert-types';

export type {
  AlertSupabase,
  PriorAlertAttempt,
  RefundReviewAlertMerchant,
  RefundReviewAlertOrder,
  RefundReviewAlertSenders,
};

const ALERT_TIMEOUT_MS = 15_000;

/** Total send attempts per review before the alert is abandoned. */
export const REFUND_ALERT_RETRY_CAP = 3;

/** Below this much remaining phase budget the alert is deferred, unclaimed. */
export const MIN_ALERT_BUDGET_MS = 8_000;

/**
 * Tell the merchant about one open refund review. The ledger row (one per
 * review) makes it idempotent across drain passes and records every
 * attempt (count + timestamp). Never throws; bounded by a per-alert timeout
 * and `deadlineMs` (the drain phase cutoff): with too little budget it
 * defers WITHOUT claiming, so a later pass retries.
 *
 * The claim is never deleted. Delivery on either channel confirms it, even
 * if that channel finishes after the timeout. Definite failures, uncertain
 * results and timeouts all leave it unconfirmed; the pending pass re-drives
 * it after a cool-down up to REFUND_ALERT_RETRY_CAP attempts, so an
 * undeliverable review cannot loop hot or monopolize the scan, and a failed
 * send is not silently lost. `prior` is the ledger state of such a claim.
 * A timed-out send may still land, which the cap accepts as a possible
 * duplicate over a lost alert.
 */
export async function alertMerchantOfRefundReview({
  deadlineMs,
  merchant,
  order,
  prior = null,
  review,
  senders,
  supabase,
}: {
  deadlineMs?: number;
  merchant: RefundReviewAlertMerchant;
  order: RefundReviewAlertOrder;
  prior?: PriorAlertAttempt | null;
  review: { candidates: unknown; id: string; metadata?: unknown };
  senders: RefundReviewAlertSenders;
  supabase: AlertSupabase;
}): Promise<'alerted' | 'deferred' | 'skipped'> {
  try {
    const remainingMs =
      deadlineMs === undefined
        ? Number.POSITIVE_INFINITY
        : deadlineMs - Date.now();
    if (remainingMs < MIN_ALERT_BUDGET_MS) return 'deferred';
    if (!(await claimAlert(supabase, review, order, prior))) return 'skipped';
    let timer: ReturnType<typeof setTimeout> | undefined;
    let outcome: ChannelOutcome;
    let confirmation: Promise<void> | undefined;
    try {
      outcome = await Promise.race([
        deliverAlert({
          merchant,
          onDelivered: () => {
            confirmation = confirmClaim(supabase, review.id);
          },
          order,
          review,
          senders,
        }),
        new Promise<ChannelOutcome>((resolve) => {
          timer = setTimeout(
            () => resolve('timeout'),
            Math.min(ALERT_TIMEOUT_MS, remainingMs)
          );
        }),
      ]);
    } catch (error) {
      logger.error({
        error,
        message: 'Cancellation refund alert failed',
        orderId: order.id,
      });
      outcome = 'failed';
    } finally {
      clearTimeout(timer);
    }
    // Persist a success seen before the timeout; a later one is best effort.
    if (confirmation) await confirmation;
    if (outcome === 'timeout') {
      logger.warn({
        attempt: (prior?.attempts ?? 0) + 1,
        message:
          'Cancellation refund alert timed out; unconfirmed, will be re-driven after cool-down',
        orderId: order.id,
        reviewId: review.id,
      });
    }
    if (
      outcome !== 'delivered' &&
      (prior?.attempts ?? 0) + 1 >= REFUND_ALERT_RETRY_CAP
    ) {
      // Terminal: the listing RPC stops returning the row at the cap.
      logger.error({
        message:
          'Cancellation refund alert abandoned after retry cap without confirmed delivery',
        orderId: order.id,
        reviewId: review.id,
      });
    }
    return 'alerted';
  } catch (error) {
    logger.error({
      error,
      message: 'Cancellation refund alert failed',
      orderId: order.id,
    });
    return 'skipped';
  }
}
