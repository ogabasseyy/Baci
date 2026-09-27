import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { isExternalPaymentGateway } from '@/lib/orders/order-cancellation-refund-review';
import { escapeHtmlText } from '@/lib/sanitize';

type RefundEmailSender = (message: {
  to: string;
  toName?: string;
  subject: string;
  htmlContent: string;
  textContent: string;
  replyTo?: string;
  emailType: 'orders' | 'notifications';
  fromName?: string;
  auditContext: {
    merchantId: string;
    orderId: string;
    customerId?: string | null;
    metadata: Record<string, string>;
  };
}) => Promise<{ deliveryOutcome?: 'unknown'; success: boolean }>;

interface NotificationRow {
  id: string;
  order_id: string;
  merchant_id: string;
  event_type:
    | 'processed_customer_email'
    | 'processed_merchant_push'
    | 'failed_merchant_push';
  claim_token: string;
}

function formatAmount(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency,
  }).format(amount);
}

export async function drainPaystackRefundNotifications(
  supabase: SupabaseClient,
  sendEmail: RefundEmailSender,
  limit = 20
): Promise<{ claimed: number; sent: number; failed: number }> {
  let claimed = 0;
  let sent = 0;
  let failed = 0;
  // Claim one row at a time: serial sends can each take tens of seconds
  // against a fixed route deadline, and unfinished processing rows are
  // deliberately never retried. A batch claimed up front could strand
  // unattempted rows past the request timeout; this way only the row
  // actually in flight can be left behind.
  for (let remaining = limit; remaining > 0; remaining -= 1) {
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
        const { data: paymentLegs, error: paymentLegError } = await supabase
          .from('transactions')
          .select('id, gateway, amount')
          .eq('order_id', order.id)
          .eq('merchant_id', row.merchant_id)
          .eq('transaction_type', 'payment')
          .eq('status', 'completed');
        if (paymentLegError || !paymentLegs?.length) {
          throw new Error('refund_notification_ledger_lookup_failed');
        }
        const externalLegs = paymentLegs.filter((leg) =>
          isExternalPaymentGateway(leg.gateway)
        );
        const { data: refundLegs, error: refundLegError } = await supabase
          .from('transactions')
          .select('amount, currency, gateway, metadata')
          .eq('order_id', order.id)
          .eq('merchant_id', row.merchant_id)
          .eq('transaction_type', 'refund')
          .eq('status', 'completed');
        if (refundLegError || !refundLegs?.length) {
          throw new Error('refund_notification_ledger_lookup_failed');
        }
        // Mirror the completion RPC: every external payment leg links one
        // same-gateway, same-amount completed refund, including legs that
        // operations refunded outside Paystack.
        const linkedRefunds = externalLegs.map((leg) =>
          refundLegs.find(
            (refund) =>
              refund.gateway === leg.gateway &&
              Number(refund.amount) === Number(leg.amount) &&
              (refund.metadata as { payment_transaction_id?: unknown } | null)
                ?.payment_transaction_id === leg.id
          )
        );
        if (
          externalLegs.length === 0 ||
          linkedRefunds.some((refund) => refund === undefined)
        ) {
          throw new Error('refund_notification_ledger_mismatch');
        }
        const refundAmount = (
          linkedRefunds as Array<{ amount: number }>
        ).reduce((sum, leg) => sum + Number(leg.amount), 0);
        if (
          refundAmount <= 0 ||
          linkedRefunds.some(
            (leg) =>
              (leg as { currency: string }).currency.toUpperCase() !==
              (order.currency || 'NGN').toUpperCase()
          )
        ) {
          throw new Error('refund_notification_ledger_mismatch');
        }
        amount = formatAmount(refundAmount, order.currency || 'NGN');
      }
      if (row.event_type === 'processed_customer_email') {
        if (!order.customer_email)
          throw new Error('refund_customer_email_missing');
        const text = `Hello ${order.customer_name || 'there'}, we have processed the refund of ${amount} for cancelled order #${orderNumber}. Your bank or card provider may take up to 10 business days to show the funds. If they do not arrive, contact ${merchant.support_email || merchant.email}.`;
        // A thrown mail call has unknown delivery outcome; do not auto-retry it.
        outcome = 'delivery_uncertain';
        const result = await sendEmail({
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
        });
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
        if (!completed && order.payment_status === 'refunded') {
          outcome = 'sent'; // A later processed event superseded the alert.
        } else {
          const title = completed
            ? 'Refund processed'
            : 'Refund needs attention';
          const body = completed
            ? `Refunds totaling ${amount} have been processed for cancelled order #${orderNumber}.`
            : `Paystack could not complete the refund for order #${orderNumber}. Check the refund in Paystack.`;
          outcome = 'delivery_uncertain';
          if (!merchant.email) {
            outcome = 'failed';
            throw new Error('refund_merchant_contact_missing');
          }
          const result = await sendEmail({
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
          });
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
  return { claimed, sent, failed };
}
