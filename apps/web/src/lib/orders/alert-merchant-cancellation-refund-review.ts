import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { buildRefundReviewAlertCopy } from '@/lib/orders/refund-review-alert-copy';
import { reviewAmountText } from '@/lib/orders/refund-review-amount';
import { escapeHtmlAttribute, escapeHtmlText } from '@/lib/sanitize';

const ALERT_TIMEOUT_MS = 15_000;

export interface RefundReviewAlertOrder {
  currency: string | null;
  id: string;
  merchant_id: string;
  order_number: string | null;
}

export interface RefundReviewAlertMerchant {
  email: string | null;
  id: string;
}

export interface RefundReviewAlertSenders {
  sendEmail: (message: {
    emailType: 'notifications';
    htmlContent: string;
    subject: string;
    textContent: string;
    to: string;
    auditContext: {
      merchantId: string;
      metadata: Record<string, string>;
      orderId: string;
    };
  }) => Promise<{ deliveryOutcome?: 'unknown'; success: boolean }>;
  sendPush: (
    merchantId: string,
    title: string,
    body: string,
    data: Record<string, unknown>,
    channelId: 'payments'
  ) => Promise<{
    deliveryOutcome?: 'unknown';
    errors?: string[];
    failed?: number;
    sent: number;
  }>;
}

/**
 * Read straight from the public build-time variable (as the cancellation
 * email builder does) instead of importing the env module, which would pull
 * credential authority into the cron worker's import graph.
 */
function dashboardBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  const base =
    configured ||
    `https://${process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'usebaci.com'}`;
  return base.replace(/\/$/, '');
}

/** Ledger state of a review whose earlier alert was never confirmed. */
export interface PriorAlertAttempt {
  attempts: number;
}

export type AlertSupabase = Pick<SupabaseClient, 'from' | 'rpc'>;

async function claimAlert(
  supabase: AlertSupabase,
  review: { id: string },
  order: RefundReviewAlertOrder,
  prior: PriorAlertAttempt | null
): Promise<boolean> {
  if (prior) {
    // Re-drive of an unconfirmed claim: compare-and-set on the attempt
    // count so two workers cannot both re-send.
    const { data, error } = await supabase
      .from('order_cancellation_refund_alerts')
      .update({
        attempts: prior.attempts + 1,
        last_attempt_at: new Date().toISOString(),
      })
      .eq('review_id', review.id)
      .eq('attempts', prior.attempts)
      .is('confirmed_at', null)
      .select('review_id');
    if (error) {
      logger.error({
        message: 'Cancellation refund alert re-claim failed',
        orderId: order.id,
        reviewId: review.id,
      });
      return false;
    }
    return Array.isArray(data) && data.length > 0;
  }
  const { error } = await supabase
    .from('order_cancellation_refund_alerts')
    .insert({
      merchant_id: order.merchant_id,
      order_id: order.id,
      review_id: review.id,
    });
  if (!error) return true;
  if ((error as { code?: string }).code !== '23505') {
    logger.error({
      message: 'Cancellation refund alert claim failed',
      orderId: order.id,
      reviewId: review.id,
    });
  }
  return false;
}

async function confirmClaim(
  supabase: AlertSupabase,
  reviewId: string
): Promise<void> {
  const { error } = await supabase
    .from('order_cancellation_refund_alerts')
    .update({ confirmed_at: new Date().toISOString() })
    .eq('review_id', reviewId);
  if (error) {
    // Left unconfirmed, the review can be re-driven once after cool-down.
    logger.error({
      message: 'Cancellation refund alert could not be confirmed',
      reviewId,
    });
  }
}

async function releaseClaim(
  supabase: AlertSupabase,
  reviewId: string
): Promise<void> {
  const { error } = await supabase
    .from('order_cancellation_refund_alerts')
    .delete()
    .eq('review_id', reviewId);
  if (error) {
    logger.error({
      message: 'Cancellation refund alert claim could not be released',
      reviewId,
    });
  }
}

type ChannelOutcome = 'delivered' | 'failed' | 'timeout' | 'uncertain';

/**
 * Mirrors attempt-merchant-refund-push: a rejection means dispatch never
 * started (failed); an unknown result or a partial failure may already
 * have reached a device (uncertain); only a clean send is delivered.
 */
function classifyPush(push: {
  deliveryOutcome?: 'unknown';
  errors?: string[];
  failed?: number;
  sent: number;
}): ChannelOutcome {
  if (
    push.deliveryOutcome === 'unknown' ||
    (push.sent > 0 &&
      ((push.failed ?? 0) > 0 || (push.errors?.length ?? 0) > 0))
  ) {
    return 'uncertain';
  }
  return push.sent > 0 ? 'delivered' : 'failed';
}

async function sendAlert({
  merchant,
  order,
  review,
  senders,
}: {
  merchant: RefundReviewAlertMerchant;
  order: RefundReviewAlertOrder;
  review: { candidates: unknown; metadata?: unknown };
  senders: RefundReviewAlertSenders;
}): Promise<ChannelOutcome> {
  const label = order.order_number ?? order.id.slice(0, 8);
  const amount = reviewAmountText(review.candidates, order.currency);
  const amountText = amount === null ? '' : ` (${amount})`;
  const { body, title } = buildRefundReviewAlertCopy({
    amountText,
    label,
    metadata: review.metadata,
  });
  // Channels run concurrently so a hung push cannot starve the email.
  const sendPush = async (): Promise<ChannelOutcome> => {
    try {
      return classifyPush(
        await senders.sendPush(
          merchant.id,
          title,
          body,
          {
            // Reuses the shipped admin deep link: this type opens the order.
            type: 'paystack_refund_needs_attention',
            order_id: order.id,
            order_number: label,
          },
          'payments'
        )
      );
    } catch (error) {
      logger.error({
        error,
        message: 'Cancellation refund alert push failed',
        orderId: order.id,
      });
      return 'failed';
    }
  };
  const sendEmail = async (): Promise<ChannelOutcome> => {
    if (!merchant.email) return 'failed';
    try {
      const link = `${dashboardBaseUrl()}/dashboard/orders/${encodeURIComponent(order.id)}`;
      const result = await senders.sendEmail({
        auditContext: {
          merchantId: merchant.id,
          metadata: { trigger: 'cancellation_refund_review_merchant_alert' },
          orderId: order.id,
        },
        emailType: 'notifications',
        htmlContent: `<p>${escapeHtmlText(body)}</p><p><a href="${escapeHtmlAttribute(link)}">Open order #${escapeHtmlText(label)}</a></p>`,
        subject: `${title}: order #${label}`,
        textContent: `${body}\n\n${link}`,
        to: merchant.email,
      });
      if (result.success) return 'delivered';
      // The provider may have accepted an email it reported as unknown.
      return result.deliveryOutcome === 'unknown' ? 'uncertain' : 'failed';
    } catch (error) {
      logger.error({
        error,
        message: 'Cancellation refund alert email failed',
        orderId: order.id,
      });
      // A throw is ambiguous: the provider may have accepted the email.
      return 'uncertain';
    }
  };
  const [pushOutcome, emailOutcome] = await Promise.all([
    sendPush(),
    sendEmail(),
  ]);

  if (pushOutcome === 'delivered' || emailOutcome === 'delivered') {
    return 'delivered';
  }
  return pushOutcome === 'uncertain' || emailOutcome === 'uncertain'
    ? 'uncertain'
    : 'failed';
}

/** Total send attempts per review before the alert is abandoned. */
export const REFUND_ALERT_RETRY_CAP = 3;

/** Below this much remaining phase budget the alert is deferred, unclaimed. */
export const MIN_ALERT_BUDGET_MS = 8_000;

/**
 * Tell the merchant about one open refund review. The claim row (one per
 * review) makes it idempotent across drain passes. Never throws and is
 * bounded by both a per-alert timeout and `deadlineMs` (the drain phase
 * cutoff): with too little budget it defers WITHOUT claiming, so a later
 * pass retries.
 *
 * Outcomes: delivered marks the claim confirmed. A definite first-attempt
 * failure releases the claim. An uncertain or timed-out send keeps the
 * claim UNCONFIRMED (attempt count and timestamp recorded in the ledger),
 * so it is not re-sent immediately but the pending pass re-drives it after
 * a cool-down, up to a retry cap: a send that ultimately failed is never
 * silently lost. `prior` is the ledger state of such an unconfirmed claim.
 * A timeout is logged distinctly; its orphaned send may still land, which
 * the capped retry accepts as a possible duplicate over a lost alert.
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
    try {
      outcome = await Promise.race([
        sendAlert({ merchant, order, review, senders }),
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
    if (outcome === 'delivered') {
      await confirmClaim(supabase, review.id);
    } else if (outcome === 'timeout') {
      logger.warn({
        attempt: (prior?.attempts ?? 0) + 1,
        message:
          'Cancellation refund alert timed out; unconfirmed, will be re-driven after cool-down',
        orderId: order.id,
        reviewId: review.id,
      });
    } else if (outcome === 'failed' && !prior) {
      await releaseClaim(supabase, review.id);
    }
    if (
      outcome !== 'delivered' &&
      prior &&
      prior.attempts + 1 >= REFUND_ALERT_RETRY_CAP
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
