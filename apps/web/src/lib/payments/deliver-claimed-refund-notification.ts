import type { SupabaseClient } from '@supabase/supabase-js';
import { escapeHtmlText } from '@/lib/sanitize';
import { zeptomailSendAdmissionBudgetMs } from '@/lib/zeptomail-send-budget';
import { assertRefundNotificationSendTime } from './assert-refund-notification-send-time';
import { awaitRefundNotificationDeadline } from './await-refund-notification-deadline';
import { refundNotificationLedgerAmount } from './refund-notification-ledger';
import { resolveContradictoryRefundFailure } from './resolve-contradictory-refund-failure';

export type RefundEmailSender = (message: {
  to: string;
  toName?: string;
  subject: string;
  htmlContent: string;
  textContent: string;
  replyTo?: string;
  emailType: 'orders' | 'notifications';
  fromName?: string;
  signal?: AbortSignal;
  fallbackDeadlineMs?: number;
  auditContext: {
    merchantId: string;
    orderId: string;
    customerId?: string | null;
    metadata: Record<string, string>;
  };
}) => Promise<{ deliveryOutcome?: 'unknown'; success: boolean }>;

export type MerchantRefundPushSender = (
  merchantId: string,
  title: string,
  body: string,
  data: Record<string, unknown>,
  channelId: 'payments'
) => Promise<{
  sent: number;
  failed: number;
  errors: string[];
  deliveryOutcome?: 'unknown';
}>;

export interface ClaimedRefundNotification {
  id: string;
  order_id: string;
  merchant_id: string;
  event_type:
    | 'processed_customer_email'
    | 'processed_merchant_push'
    | 'failed_merchant_push';
  claim_token: string;
  created_at: string;
  generation: number;
}

interface RefundNotificationOrder {
  id: string;
  merchant_id: string;
  order_number: string | null;
  customer_email: string | null;
  customer_name: string | null;
  customer_id: string | null;
  currency: string | null;
  payment_status: string;
  cancelled_at: string | null;
}

interface RefundNotificationMerchant {
  id: string;
  business_name: string;
  email: string;
  support_email: string | null;
  email_sender_name: string | null;
}

export type RefundNotificationOutcome =
  | 'sent'
  | 'failed'
  | 'delivery_uncertain';

/**
 * Deliver one claimed refund notification and report its outcome.
 * Never throws for delivery problems: thrown sends and failed lookups
 * collapse to failed or delivery_uncertain for the caller to persist.
 * Loop control and outcome persistence stay with the caller.
 */
export async function deliverClaimedRefundNotification({
  deadlineMs,
  row,
  sendEmail,
  sendMerchantPush,
  supabase,
}: {
  deadlineMs?: number;
  row: ClaimedRefundNotification;
  sendEmail: RefundEmailSender;
  sendMerchantPush?: MerchantRefundPushSender;
  supabase: SupabaseClient;
}): Promise<{
  lastError: string | null;
  outcome: RefundNotificationOutcome;
}> {
  let outcome: RefundNotificationOutcome = 'failed';
  let lastError: string | null = null;
  try {
    const { data: orderData, error: orderError } = await supabase
      .from('orders')
      .select(
        'id, merchant_id, order_number, customer_email, customer_name, customer_id, currency, payment_status, cancelled_at'
      )
      .eq('id', row.order_id)
      .eq('merchant_id', row.merchant_id)
      .single();
    const order = orderData as RefundNotificationOrder | null;
    if (orderError || !order || !order.cancelled_at) {
      throw new Error('refund_notification_order_lookup_failed');
    }
    const { data: merchantData, error: merchantError } = await supabase
      .from('merchants')
      .select('id, business_name, email, support_email, email_sender_name')
      .eq('id', row.merchant_id)
      .single();
    const merchant = merchantData as RefundNotificationMerchant | null;
    if (merchantError || !merchant) {
      throw new Error('refund_notification_merchant_lookup_failed');
    }
    if (
      row.event_type.startsWith('processed_') &&
      order.payment_status !== 'refunded'
    ) {
      // The queue is seeded only after the atomic refunded transition.
      // A later state change needs review, not automatic mail retries.
      outcome = 'delivery_uncertain';
      throw new Error('order_refund_not_complete');
    }
    const orderNumber =
      order.order_number || order.id.slice(0, 8).toUpperCase();
    let amount = '';
    if (row.event_type.startsWith('processed_')) {
      amount = await refundNotificationLedgerAmount({
        merchantId: row.merchant_id,
        order,
        supabase,
      });
    }
    if (row.event_type === 'processed_customer_email') {
      if (!order.customer_email)
        throw new Error('refund_customer_email_missing');
      const text = `Hello ${order.customer_name || 'there'}, we have processed the refund of ${amount} for cancelled order #${orderNumber}. Your bank or card provider may take up to 10 business days to show the funds. If they do not arrive, contact ${merchant.support_email || merchant.email}.`;
      // Admit on the full four-attempt sender budget: starting the
      // uncapped loop short of it aborts mid-send into
      // delivery_uncertain.
      assertRefundNotificationSendTime(
        deadlineMs,
        zeptomailSendAdmissionBudgetMs()
      );
      // A thrown mail call has unknown delivery outcome; do not auto-retry it.
      outcome = 'delivery_uncertain';
      const result = await awaitRefundNotificationDeadline(
        sendEmail({
          ...(deadlineMs !== undefined && {
            signal: AbortSignal.timeout(
              Math.max(1, deadlineMs - Date.now() - 10_000)
            ),
            // Match the signal's 10s buffer: the platform-sender
            // fallback declines unless its full retry loop fits.
            fallbackDeadlineMs: deadlineMs - 10_000,
          }),
          to: order.customer_email,
          toName: order.customer_name ?? undefined,
          subject: `Refund processed for order #${orderNumber}`,
          textContent: text,
          htmlContent: `<p>Hello ${escapeHtmlText(order.customer_name || 'there')},</p><p>We have processed the refund of <strong>${escapeHtmlText(amount)}</strong> for cancelled order #${escapeHtmlText(orderNumber)}.</p><p>Your bank or card provider may take up to 10 business days to show the funds. If they do not arrive, contact ${escapeHtmlText(merchant.support_email || merchant.email)}.</p>`,
          replyTo: merchant.support_email || merchant.email,
          fromName: merchant.email_sender_name || merchant.business_name,
          emailType: 'orders',
          auditContext: {
            merchantId: merchant.id,
            orderId: order.id,
            customerId: order.customer_id,
            metadata: { trigger: 'paystack_refund_processed' },
          },
        }),
        deadlineMs
      );
      if (result.success) {
        outcome = 'sent';
      } else if (result.deliveryOutcome === 'unknown') {
        outcome = 'delivery_uncertain';
        lastError = 'refund_customer_email_unknown';
      } else {
        outcome = 'failed';
        lastError = 'refund_customer_email_rejected';
      }
    } else {
      const completed = row.event_type === 'processed_merchant_push';
      // A refunded order usually means a later processed event
      // superseded this alert — but a post-transition failure is fresh
      // contradiction: suppress only on durable replacement evidence.
      const contradictoryFailure =
        !completed && order.payment_status === 'refunded';
      const superseded =
        contradictoryFailure &&
        (await resolveContradictoryRefundFailure(supabase, row, order));
      if (superseded) {
        outcome = 'sent';
      } else {
        const title = completed ? 'Refund processed' : 'Refund needs attention';
        const body = completed
          ? `Refunds totaling ${amount} have been processed for cancelled order #${orderNumber}.`
          : `Paystack could not complete the refund for order #${orderNumber}. Check the refund in Paystack.`;
        assertRefundNotificationSendTime(deadlineMs);
        outcome = 'delivery_uncertain';
        if (sendMerchantPush) {
          const pushPromise = sendMerchantPush(
            merchant.id,
            title,
            body,
            {
              type: completed
                ? 'paystack_refund_processed'
                : 'paystack_refund_needs_attention',
              order_id: order.id,
              order_number: orderNumber,
            },
            'payments'
          );
          const pushed = await awaitRefundNotificationDeadline(
            pushPromise,
            deadlineMs
          );
          if (
            pushed.deliveryOutcome === 'unknown' ||
            (pushed.sent > 0 && (pushed.failed > 0 || pushed.errors.length > 0))
          ) {
            throw new Error('refund_merchant_push_uncertain');
          }
          if (pushed.sent > 0) outcome = 'sent';
        }
        // No active app token: deliver the same notification by email.
        if (outcome !== 'sent' && !merchant.email) {
          outcome = 'failed';
          throw new Error('refund_merchant_contact_missing');
        }
        if (outcome !== 'sent') {
          outcome = 'failed';
          // Re-check the FULL sender budget after push consumed part
          // of the row's reserve.
          assertRefundNotificationSendTime(
            deadlineMs,
            zeptomailSendAdmissionBudgetMs()
          );
          outcome = 'delivery_uncertain';
          const result = await awaitRefundNotificationDeadline(
            sendEmail({
              ...(deadlineMs !== undefined && {
                signal: AbortSignal.timeout(
                  Math.max(1, deadlineMs - Date.now() - 10_000)
                ),
                // Match the signal's 10s buffer: the platform-sender
                // fallback declines unless its full retry loop fits.
                fallbackDeadlineMs: deadlineMs - 10_000,
              }),
              to: merchant.email,
              subject: `${title}: order #${orderNumber}`,
              textContent: body,
              htmlContent: `<p>${escapeHtmlText(body)}</p>`,
              emailType: 'notifications',
              auditContext: {
                merchantId: merchant.id,
                orderId: order.id,
                metadata: {
                  trigger: completed
                    ? 'paystack_refund_processed_merchant'
                    : 'paystack_refund_attention_merchant',
                },
              },
            }),
            deadlineMs
          );
          if (result.success) {
            outcome = 'sent';
          } else if (result.deliveryOutcome === 'unknown') {
            outcome = 'delivery_uncertain';
            lastError = 'refund_merchant_email_unknown';
          } else {
            outcome = 'failed';
            lastError = 'refund_merchant_email_rejected';
          }
        }
      }
    }
  } catch (error) {
    lastError =
      error instanceof Error ? error.message : 'refund_notification_failed';
    if (outcome !== 'delivery_uncertain') outcome = 'failed';
  }
  return { lastError, outcome };
}
