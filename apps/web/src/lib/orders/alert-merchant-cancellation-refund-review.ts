import { logger } from '@/lib/logger';
import {
  claimAlert,
  confirmClaim,
  markUndeliverable,
} from '@/lib/orders/refund-alert-claims';
import {
  MIN_ALERT_BUDGET_MS,
  REFUND_ALERT_RETRY_CAP,
} from '@/lib/orders/refund-alert-constants';
import { deliverAlert } from '@/lib/orders/refund-alert-delivery';
import { runBounded } from '@/lib/orders/refund-alert-lookup';
import type {
  AlertSupabase,
  ChannelOutcome,
  PriorAlertAttempt,
  RefundReviewAlertMerchant,
  RefundReviewAlertOrder,
  RefundReviewAlertSenders,
} from '@/lib/orders/refund-alert-types';

const ALERT_TIMEOUT_MS = 15_000;
// After the outer timeout, wait this long (within the drain budget) for the
// detached delivery so a just-late success is confirmed before returning.
const TIMEOUT_GRACE_MS = 2_000;

/**
 * delivered: a channel confirmed. failed: every channel definitely failed.
 * uncertain: ambiguous result or timeout. duplicate: already claimed
 * elsewhere (benign). undeliverable: the merchant has no push device and no
 * email, so retrying cannot help (kept unconfirmed, re-checked on a long cool-down without consuming retries). deferred: no budget, unclaimed. skipped: the claim or
 * the attempt itself errored.
 */
type RefundAlertOutcome =
  | 'delivered'
  | 'deferred'
  | 'duplicate'
  | 'failed'
  | 'skipped'
  | 'uncertain'
  | 'undeliverable';

/** Bounded wait for a never-throwing write, within the drain budget. */
async function awaitWithin(
  work: Promise<void>,
  deadlineMs: number | undefined
): Promise<void> {
  const ms = Math.max(
    0,
    Math.min(
      TIMEOUT_GRACE_MS,
      deadlineMs === undefined ? TIMEOUT_GRACE_MS : deadlineMs - Date.now()
    )
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    work,
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, ms);
    }),
  ]);
  clearTimeout(timer);
}

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
}): Promise<RefundAlertOutcome> {
  try {
    const remainingMs =
      deadlineMs === undefined
        ? Number.POSITIVE_INFINITY
        : deadlineMs - Date.now();
    if (remainingMs < MIN_ALERT_BUDGET_MS) return 'deferred';
    // Bound the claim write by the absolute phase deadline (abortable). A
    // timed-out write may still land server-side: that leaves an unconfirmed
    // claim which the next pass re-drives after the cool-down, the intended
    // safe outcome. Delivery never starts after a timed-out claim, and the
    // pass stops on 'deferred', so a late-landing claim cannot cause a
    // duplicate send within this pass.
    const claimResult = await runBounded(deadlineMs, (signal) =>
      claimAlert(supabase, review, order, prior, signal)
    );
    if (claimResult.timedOut) {
      logger.warn({
        message: 'Cancellation refund alert claim timed out; deferring',
        orderId: order.id,
        reviewId: review.id,
      });
      return 'deferred';
    }
    const claim = claimResult.value;
    if (claim === 'duplicate') return 'duplicate';
    if (claim === 'error') return 'skipped';
    let timer: ReturnType<typeof setTimeout> | undefined;
    let outcome: ChannelOutcome;
    let confirmation: Promise<void> | undefined;
    try {
      const delivery = deliverAlert({
        merchant,
        onDelivered: () => {
          confirmation = confirmClaim(supabase, review.id);
        },
        order,
        review,
        senders,
      }).catch((error): ChannelOutcome => {
        logger.error({
          error,
          message: 'Cancellation refund alert delivery rejected',
          orderId: order.id,
        });
        return 'failed';
      });
      outcome = await Promise.race([
        delivery,
        new Promise<ChannelOutcome>((resolve) => {
          timer = setTimeout(
            () => resolve('timeout'),
            // Absolute deadline, recomputed after the (possibly slow) claim.
            Math.min(
              ALERT_TIMEOUT_MS,
              deadlineMs === undefined
                ? ALERT_TIMEOUT_MS
                : Math.max(0, deadlineMs - Date.now())
            )
          );
        }),
      ]);
      if (outcome === 'timeout') {
        // Bounded grace for the loser; its rejection is already caught.
        const graceMs = Math.max(
          0,
          Math.min(
            TIMEOUT_GRACE_MS,
            deadlineMs === undefined
              ? TIMEOUT_GRACE_MS
              : deadlineMs - Date.now()
          )
        );
        if (graceMs > 0) {
          let graceTimer: ReturnType<typeof setTimeout> | undefined;
          await Promise.race([
            delivery,
            new Promise<void>((resolve) => {
              graceTimer = setTimeout(resolve, graceMs);
            }),
          ]);
          clearTimeout(graceTimer);
        }
        if (confirmation) outcome = 'delivered';
      }
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
    if (confirmation) await awaitWithin(confirmation, deadlineMs);
    if (outcome === 'undeliverable') {
      logger.warn({
        message:
          'Cancellation refund alert undeliverable: merchant has no push device or email; re-checking after a long cool-down without consuming retries',
        orderId: order.id,
        reviewId: review.id,
      });
      await awaitWithin(
        markUndeliverable(supabase, review.id, prior?.attempts ?? 0),
        deadlineMs
      );
      return 'undeliverable';
    }
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
    if (outcome === 'delivered') return 'delivered';
    return outcome === 'failed' ? 'failed' : 'uncertain';
  } catch (error) {
    logger.error({
      error,
      message: 'Cancellation refund alert failed',
      orderId: order.id,
    });
    return 'skipped';
  }
}
