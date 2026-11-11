import { logger } from '@/lib/logger';
import type {
  ChannelOutcome,
  RefundReviewAlertMerchant,
  RefundReviewAlertOrder,
  RefundReviewAlertSenders,
} from '@/lib/orders/refund-alert-types';
import { buildRefundReviewAlertCopy } from '@/lib/orders/refund-review-alert-copy';
import { reviewAmountText } from '@/lib/orders/refund-review-amount';
import { escapeHtmlAttribute, escapeHtmlText } from '@/lib/sanitize';

const MAX_LABEL_LENGTH = 40;

/**
 * Order numbers are merchant-controlled text: strip control characters
 * (CR/LF would otherwise reach the email Subject header) and cap length.
 */
export function sanitizeOrderLabel(raw: string): string {
  // Cc/Cf cover C0/C1 controls, bidi overrides/isolates and zero-width marks
  // (U+FEFF included); LS/PS are Zl/Zp so they are listed explicitly.
  return raw
    .replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, '')
    .trim()
    .slice(0, MAX_LABEL_LENGTH);
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
  if (push.sent > 0) return 'delivered';
  // No devices and no error: the channel is unavailable, not failing.
  return (push.failed ?? 0) === 0 && (push.errors?.length ?? 0) === 0
    ? 'skipped'
    : 'failed';
}

/**
 * Send the alert over push and email concurrently. `onDelivered` fires as
 * soon as EITHER channel is confirmed delivered (once), even if the other
 * channel is still pending or the caller has already timed out, so a
 * success is persisted independently of the slower channel.
 */
export async function deliverAlert({
  merchant,
  onDelivered,
  order,
  review,
  senders,
}: {
  merchant: RefundReviewAlertMerchant;
  onDelivered: () => void;
  order: RefundReviewAlertOrder;
  review: { candidates: unknown; metadata?: unknown };
  senders: RefundReviewAlertSenders;
}): Promise<ChannelOutcome> {
  const label =
    sanitizeOrderLabel(order.order_number ?? '') || order.id.slice(0, 8);
  // Visible push copy and payload use the same metacharacter-free label;
  // the email keeps HTML escaping for its own rendering.
  const copyLabel = label.replace(/[<>&"']/g, '');
  const amount = reviewAmountText(review.candidates, order.currency, order.id);
  const amountText = amount === null ? '' : ` (${amount})`;
  const { body, title } = buildRefundReviewAlertCopy({
    amountText,
    label: copyLabel,
    metadata: review.metadata,
  });
  let notified = false;
  const track = async (
    run: () => Promise<ChannelOutcome>
  ): Promise<ChannelOutcome> => {
    const outcome = await run();
    if (outcome === 'delivered' && !notified) {
      notified = true;
      onDelivered();
    }
    return outcome;
  };
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
    if (!merchant.email) return 'skipped';
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
      // sendEmail's documented dispatch boundary: a throw means no
      // dispatch happened (transport failures resolve as results).
      return 'failed';
    }
  };
  const [pushOutcome, emailOutcome] = await Promise.all([
    track(sendPush),
    track(sendEmail),
  ]);
  if (pushOutcome === 'delivered' || emailOutcome === 'delivered') {
    return 'delivered';
  }
  if (pushOutcome === 'uncertain' || emailOutcome === 'uncertain') {
    return 'uncertain';
  }
  // Both channels unavailable (no devices, no email): retrying cannot help.
  return pushOutcome === 'skipped' && emailOutcome === 'skipped'
    ? 'undeliverable'
    : 'failed';
}
