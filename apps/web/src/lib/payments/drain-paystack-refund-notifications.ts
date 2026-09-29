import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { escapeHtmlText } from '@/lib/sanitize';
import { assertRefundNotificationSendTime } from './assert-refund-notification-send-time';
import { awaitRefundNotificationDeadline } from './await-refund-notification-deadline';
import { countDeadLetteredPaystackRefundNotifications } from './count-dead-lettered-paystack-refund-notifications';
import { refundNotificationLedgerAmount } from './refund-notification-ledger';
import { resolveContradictoryRefundFailure } from './resolve-contradictory-refund-failure';

type RefundEmailSender = (message: {
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

interface NotificationRow {
  id: string;
  order_id: string;
  merchant_id: string;
  event_type:
    | 'processed_customer_email'
    | 'processed_merchant_push'
    | 'failed_merchant_push';
  claim_token: string;
  created_at: string;
}

export async function drainPaystackRefundNotifications(
  supabase: SupabaseClient,
  sendEmail: RefundEmailSender,
  limit = 20,
  sendMerchantPush?: MerchantRefundPushSender,
  deadlineMs?: number
): Promise<{
  claimed: number;
  sent: number;
  failed: number;
  exhausted: number;
}> {
  let claimed = 0;
  let sent = 0;
  let failed = 0;
  let exhausted = 0;
  if (limit > 0) {
    exhausted = await countDeadLetteredPaystackRefundNotifications(supabase);
  }
  // Claim serially so a route timeout cannot strand an unsent batch.
  for (let remaining = limit; remaining > 0; remaining -= 1) {
    // Reserve time for the provider call and outcome write.
    if (deadlineMs !== undefined && deadlineMs - Date.now() < 45_000) break;
    const { data, error } = await supabase.rpc(
      'claim_paystack_cancellation_refund_notifications_v1',
      { p_limit: 1 }
    );
    if (error) throw new Error('refund_notification_claim_failed');
    const [row] = (data ?? []) as NotificationRow[];
    if (!row) break;
    claimed += 1;
    let outcome: 'sent' | 'failed' | 'delivery_uncertain' = 'failed';
    let lastError: string | null = null;
    try {
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .select(
          'id, merchant_id, order_number, customer_email, customer_name, customer_id, currency, payment_status, cancelled_at'
        )
        .eq('id', row.order_id)
        .eq('merchant_id', row.merchant_id)
        .single();
      if (orderError || !order || !order.cancelled_at) {
        throw new Error('refund_notification_order_lookup_failed');
      }
      const { data: merchant, error: merchantError } = await supabase
        .from('merchants')
        .select('id, business_name, email, support_email, email_sender_name')
        .eq('id', row.merchant_id)
        .single();
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
        assertRefundNotificationSendTime(deadlineMs);
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
        // superseded this failure alert — but a failure reported after
        // the refunded transition is fresh contradiction. Suppress only
        // on durable replacement evidence; otherwise the helper files a
        // falsely-refunded review and the alert below still sends.
        const contradictoryFailure =
          !completed && order.payment_status === 'refunded';
        const superseded =
          contradictoryFailure &&
          (await resolveContradictoryRefundFailure(supabase, row, order));
        if (superseded) {
          outcome = 'sent';
        } else {
          const title = completed
            ? 'Refund processed'
            : 'Refund needs attention';
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
              (pushed.sent > 0 &&
                (pushed.failed > 0 || pushed.errors.length > 0))
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
            assertRefundNotificationSendTime(deadlineMs);
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
    const { data: finished, error: finishError } = await supabase
      .from('paystack_cancellation_refund_notifications')
      .update({
        status: outcome,
        last_error: lastError,
        sent_at: outcome === 'sent' ? new Date().toISOString() : null,
      })
      .eq('id', row.id)
      .eq('claim_token', row.claim_token)
      .eq('status', 'processing')
      .select('id')
      .maybeSingle();
    if (finishError || !finished) {
      logger.error({
        message: 'Refund notification delivery outcome could not be persisted',
        notificationId: row.id,
      });
      failed++;
      continue;
    }
    if (outcome === 'sent') sent++;
    else failed++;
  }
  return { claimed, sent, failed, exhausted };
}
