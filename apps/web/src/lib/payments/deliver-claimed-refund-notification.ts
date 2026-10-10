import type { SupabaseClient } from '@supabase/supabase-js';
import { escapeHtmlText } from '@/lib/sanitize';
import { zeptomailSendAdmissionBudgetMs } from '@/lib/zeptomail-send-budget';
import {
  assertRefundNotificationSendTime,
  isRefundNotificationSendAdmissionRefusal,
} from './assert-refund-notification-send-time';
import { awaitRefundNotificationDeadline } from './await-refund-notification-deadline';
import { deliverMerchantRefundNotification } from './deliver-merchant-refund-notification';
import { refundNotificationLedgerAmount } from './refund-notification-ledger';

export type RefundEmailSender = (message: {
  to: string;
  toName?: string;
  subject: string;
  htmlContent: string;
  textContent: string;
  replyTo?: string;
  emailType: 'orders' | 'notifications';
  fromName?: string;
  maxAttemptsPerSender?: number;
  signal?: AbortSignal;
  fallbackDeadlineMs?: number;
  // Dispatch boundary probes (mirroring zeptomail.ts): the sender
  // invokes beforeTransportDispatch ahead of the first transport
  // attempt, so a throw with no probe call never sent and stays
  // retryable instead of terminalizing as delivery_uncertain.
  beforeTransportDispatch?: () => Promise<void>;
  resetTransportDispatch?: () => Promise<void>;
  auditContext: {
    merchantId: string;
    orderId: string;
    customerId?: string | null;
    metadata: Record<string, string>;
  };
}) => Promise<{ deliveryOutcome?: 'unknown'; success: boolean }>;

/**
 * Merchant push sender for refund notifications. Reject only when
 * provider dispatch definitely never started (a pre-dispatch setup
 * failure) — the drain retries those and still runs the merchant-email
 * fallback. Resolve with `deliveryOutcome: 'unknown'` when dispatch
 * started but the outcome is unknown; those terminalize without
 * fallback or retry. Production `notifyMerchant` implements this.
 */
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
  attempts: number;
}

export interface RefundNotificationOrder {
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

export interface RefundNotificationMerchant {
  id: string;
  business_name: string;
  email: string;
  support_email: string | null;
  email_sender_name: string | null;
}

export type RefundNotificationOutcome =
  | 'sent'
  | 'failed'
  | 'delivery_uncertain'
  | 'deferred';

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
      // A thrown mail call is genuinely uncertain only once
      // dispatch started: a pre-dispatch throw (sender resolution,
      // missing token) never sent, so the probe keeps it retryable
      // instead of terminalizing a healthy notification.
      let emailDispatchStarted = false;
      outcome = 'delivery_uncertain';
      try {
        const result = await awaitRefundNotificationDeadline(
          sendEmail({
            ...(deadlineMs !== undefined && {
              signal: AbortSignal.timeout(
                Math.max(1, deadlineMs - Date.now() - 10_000)
              ),
              // Match the signal's 10s buffer: the platform-sender
              // fallback is a single shot that declines unless one
              // attempt fits.
              fallbackDeadlineMs: deadlineMs - 10_000,
            }),
            beforeTransportDispatch: () => {
              emailDispatchStarted = true;
              return Promise.resolve();
            },
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
      } catch (mailError) {
        // A reset never un-sends: once the probe fired, the throw
        // stays uncertain however the retry loop reset it.
        if (!emailDispatchStarted) outcome = 'failed';
        throw mailError;
      }
    } else {
      ({ lastError, outcome } = await deliverMerchantRefundNotification(
        supabase,
        {
          amount,
          deadlineMs,
          merchant,
          order,
          orderNumber,
          row,
          sendEmail,
          sendMerchantPush,
        }
      ));
    }
  } catch (error) {
    lastError =
      error instanceof Error ? error.message : 'refund_notification_failed';
    // A pre-send budget refusal never attempted delivery: report it
    // as deferred so the caller releases the row without burning the
    // attempt the claim just added. Collapsing it to failed would
    // dead-letter a healthy notification after five tight-budget
    // ticks without ever sending it.
    if (isRefundNotificationSendAdmissionRefusal(error)) {
      outcome = 'deferred';
    } else if (outcome !== 'delivery_uncertain') {
      outcome = 'failed';
    }
  }
  return { lastError, outcome };
}
