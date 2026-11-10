import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
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
  }) => Promise<{ success: boolean }>;
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

async function loadDefaultSenders(): Promise<RefundReviewAlertSenders> {
  const [{ notifyMerchant }, { sendEmail }] = await Promise.all([
    import('@/lib/expo-push'),
    import('@/lib/zeptomail'),
  ]);
  return { sendEmail, sendPush: notifyMerchant };
}

async function claimAlert(
  supabase: Pick<SupabaseClient, 'from'>,
  review: { id: string },
  order: RefundReviewAlertOrder
): Promise<boolean> {
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

async function releaseClaim(
  supabase: Pick<SupabaseClient, 'from'>,
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

type ChannelOutcome = 'delivered' | 'failed' | 'uncertain';

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
  review: { candidates: unknown };
  senders: RefundReviewAlertSenders;
}): Promise<ChannelOutcome> {
  const label = order.order_number ?? order.id.slice(0, 8);
  const amount = reviewAmountText(review.candidates, order.currency);
  const amountText = amount === null ? '' : ` (${amount})`;
  const title = 'Refund needs attention';
  const body = `Refund for order #${label}${amountText} couldn't be completed automatically. Open the order to refund manually.`;
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
      const { getAppUrl } = await import('@/env');
      const link = `${getAppUrl().replace(/\/$/, '')}/dashboard/orders/${encodeURIComponent(order.id)}`;
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
      return result.success ? 'delivered' : 'failed';
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

/** Below this much remaining phase budget the alert is deferred, unclaimed. */
export const MIN_ALERT_BUDGET_MS = 8_000;

/**
 * Tell the merchant once about one open refund review. The claim row
 * (one per review) makes it idempotent across drain passes. Never throws
 * and is bounded by both a per-alert timeout and `deadlineMs` (the drain
 * phase cutoff): with too little budget it defers WITHOUT claiming, so a
 * later pass retries. The claim is released only when nothing was
 * delivered and nothing is uncertain; an uncertain or timed-out send keeps
 * it so the merchant is not alerted twice. The decision is taken here,
 * after settlement or timeout, never by an orphaned send.
 */
export async function alertMerchantOfRefundReview({
  deadlineMs,
  merchant,
  order,
  review,
  senders,
  supabase,
}: {
  deadlineMs?: number;
  merchant: RefundReviewAlertMerchant;
  order: RefundReviewAlertOrder;
  review: { candidates: unknown; id: string };
  senders?: RefundReviewAlertSenders;
  supabase: Pick<SupabaseClient, 'from'>;
}): Promise<'alerted' | 'deferred' | 'skipped'> {
  try {
    const remainingMs =
      deadlineMs === undefined
        ? Number.POSITIVE_INFINITY
        : deadlineMs - Date.now();
    if (remainingMs < MIN_ALERT_BUDGET_MS) return 'deferred';
    if (!(await claimAlert(supabase, review, order))) return 'skipped';
    let timer: ReturnType<typeof setTimeout> | undefined;
    let outcome: ChannelOutcome;
    try {
      const resolved = senders ?? (await loadDefaultSenders());
      outcome = await Promise.race([
        sendAlert({ merchant, order, review, senders: resolved }),
        new Promise<ChannelOutcome>((resolve) => {
          timer = setTimeout(
            () => resolve('uncertain'),
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
    if (outcome === 'failed') await releaseClaim(supabase, review.id);
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
