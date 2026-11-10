import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { escapeHtmlText } from '@/lib/sanitize';

const REVIEW_ISSUE_TYPE = 'order_cancellation_refund_requires_review';
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
  ) => Promise<{ sent: number }>;
}

async function loadDefaultSenders(): Promise<RefundReviewAlertSenders> {
  const [{ notifyMerchant }, { sendEmail }] = await Promise.all([
    import('@/lib/expo-push'),
    import('@/lib/zeptomail'),
  ]);
  return { sendEmail, sendPush: notifyMerchant };
}

function formatAmount(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-NG', {
      currency,
      minimumFractionDigits: 0,
      style: 'currency',
    }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

function reviewAmount(candidates: unknown): number | null {
  if (!Array.isArray(candidates)) return null;
  let total = 0;
  let counted = 0;
  for (const candidate of candidates) {
    const amount = Number((candidate as { amount?: unknown } | null)?.amount);
    if (Number.isFinite(amount) && amount > 0) {
      total += amount;
      counted += 1;
    }
  }
  return counted > 0 ? total : null;
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

async function deliverAlert({
  merchant,
  order,
  review,
  senders,
  supabase,
}: {
  merchant: RefundReviewAlertMerchant;
  order: RefundReviewAlertOrder;
  review: { candidates: unknown; id: string };
  senders: RefundReviewAlertSenders;
  supabase: Pick<SupabaseClient, 'from'>;
}): Promise<void> {
  const label = order.order_number ?? order.id.slice(0, 8);
  const amount = reviewAmount(review.candidates);
  const amountText =
    amount === null
      ? ''
      : ` (${formatAmount(amount, order.currency ?? 'NGN')})`;
  const title = 'Refund needs attention';
  const body = `Refund for order #${label}${amountText} couldn't be completed automatically. Open the order to refund manually.`;
  let delivered = false;

  try {
    const push = await senders.sendPush(
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
    );
    delivered = push.sent > 0;
  } catch (error) {
    logger.error({
      error,
      message: 'Cancellation refund alert push failed',
      orderId: order.id,
    });
  }

  if (merchant.email) {
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
        htmlContent: `<p>${escapeHtmlText(body)}</p><p><a href="${escapeHtmlText(link)}">Open order #${escapeHtmlText(label)}</a></p>`,
        subject: `${title}: order #${label}`,
        textContent: `${body}\n\n${link}`,
        to: merchant.email,
      });
      delivered = delivered || result.success;
    } catch (error) {
      logger.error({
        error,
        message: 'Cancellation refund alert email failed',
        orderId: order.id,
      });
    }
  }

  // Nothing reached the merchant: free the claim so a later drain pass
  // retries instead of silently swallowing the alert.
  if (!delivered) await releaseClaim(supabase, review.id);
}

/**
 * Tell the merchant once when a cancellation refund has an open review.
 * The claim row (one per review) makes it idempotent across drain
 * retries. Never throws and is time-boxed: alert problems must not
 * break or delay the refund worker.
 */
export async function alertMerchantOfCancellationRefundReview({
  merchant,
  order,
  senders,
  supabase,
}: {
  merchant: RefundReviewAlertMerchant;
  order: RefundReviewAlertOrder;
  senders?: RefundReviewAlertSenders;
  supabase: Pick<SupabaseClient, 'from'>;
}): Promise<void> {
  try {
    const { data: reviews, error } = await supabase
      .from('reconciliation_review')
      .select('id, candidates')
      .eq('issue_type', REVIEW_ISSUE_TYPE)
      .eq('order_id', order.id)
      .eq('merchant_id', order.merchant_id)
      .is('resolved_at', null);
    if (error) {
      logger.error({
        message: 'Cancellation refund alert review lookup failed',
        orderId: order.id,
      });
      return;
    }
    for (const review of (reviews ?? []) as Array<{
      candidates: unknown;
      id: string;
    }>) {
      if (!(await claimAlert(supabase, review, order))) continue;
      const resolved = senders ?? (await loadDefaultSenders());
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          deliverAlert({
            merchant,
            order,
            review,
            senders: resolved,
            supabase,
          }),
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, ALERT_TIMEOUT_MS);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    }
  } catch (error) {
    logger.error({
      error,
      message: 'Cancellation refund alert failed',
      orderId: order.id,
    });
  }
}
