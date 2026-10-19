import type { SupabaseClient } from '@supabase/supabase-js';
import { escapeHtmlText } from '@/lib/sanitize';
import { zeptomailSendAdmissionBudgetMs } from '@/lib/zeptomail-send-budget';
import {
  assertRefundNotificationSendTime,
  isRefundNotificationSendAdmissionRefusal,
} from './assert-refund-notification-send-time';
import { attemptMerchantRefundPush } from './attempt-merchant-refund-push';
import { awaitRefundNotificationDeadline } from './await-refund-notification-deadline';
import type {
  ClaimedRefundNotification,
  MerchantRefundPushSender,
  RefundEmailSender,
  RefundNotificationMerchant,
  RefundNotificationOrder,
  RefundNotificationOutcome,
} from './deliver-claimed-refund-notification';
import { resolveContradictoryRefundFailure } from './resolve-contradictory-refund-failure';

// Worst-case allowance for the merchant-push phase (token read, one
// Expo request, audit write) before the merchant-email fallback. The
// 150s row budget cannot cover an unbounded push plus the email send,
// so the push is skipped unless both phases fit (see below): starting
// a push that starves the email burns the attempt on a budget-only
// failure every backlog run until the notification dead-letters, even
// with healthy delivery. Typical pushes finish in seconds; a push
// that overruns its allowance still fails the row retryably via the
// post-push email assert instead of stranding it as uncertain.
const MERCHANT_PUSH_PHASE_WORST_MS = 30_000;

/**
 * Deliver the merchant leg of a claimed refund notification: push
 * first when the push phase plus the capped fallback email both fit,
 * otherwise the capped email directly. Never throws for delivery
 * problems: budget and lookup failures collapse to failed (or
 * delivery_uncertain when push dispatch may have started), mirroring
 * the customer path's contract.
 */
export async function deliverMerchantRefundNotification(
  supabase: SupabaseClient,
  {
    amount,
    deadlineMs,
    merchant,
    order,
    orderNumber,
    row,
    sendEmail,
    sendMerchantPush,
  }: {
    amount: string;
    deadlineMs?: number;
    merchant: RefundNotificationMerchant;
    order: RefundNotificationOrder;
    orderNumber: string;
    row: ClaimedRefundNotification;
    sendEmail: RefundEmailSender;
    sendMerchantPush?: MerchantRefundPushSender;
  }
): Promise<{
  lastError: string | null;
  outcome: RefundNotificationOutcome;
}> {
  let outcome: RefundNotificationOutcome = 'failed';
  let lastError: string | null = null;
  try {
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
      // Skip the push unless the push phase plus the capped fallback
      // email both fit the remaining row budget: with only email
      // room left, sending the email directly beats burning the
      // attempt on a push that starves it.
      const pushAllowanceMs =
        MERCHANT_PUSH_PHASE_WORST_MS + zeptomailSendAdmissionBudgetMs(1);
      const pushFits =
        deadlineMs === undefined || deadlineMs - Date.now() >= pushAllowanceMs;
      if (sendMerchantPush && pushFits) {
        const push = await attemptMerchantRefundPush({
          body,
          completed,
          deadlineMs,
          merchantId: merchant.id,
          orderId: order.id,
          orderNumber,
          sendMerchantPush,
          title,
        });
        outcome = push.outcome;
        lastError = push.lastError;
        // Uncertain dispatch stays terminal: retrying or emailing after
        // a possibly-delivered push double-notifies the merchant.
        if (push.outcome === 'delivery_uncertain') {
          throw new Error('refund_merchant_push_uncertain');
        }
      }
      // No active app token: deliver the same notification by email.
      if (outcome !== 'sent' && !merchant.email) {
        outcome = 'failed';
        throw new Error('refund_merchant_contact_missing');
      }
      if (outcome !== 'sent') {
        outcome = 'failed';
        // The fallback email runs capped at one primary attempt
        // (the verified-wedge precedent): the row budget already
        // spent the push phase, and the sweep retries transient
        // failures next tick. Assert the single-attempt budget —
        // the full four-attempt loop never fits after a push.
        assertRefundNotificationSendTime(
          deadlineMs,
          zeptomailSendAdmissionBudgetMs(1)
        );
        // As on the customer path: a pre-dispatch throw never sent,
        // so the probe keeps it retryable; only a post-dispatch
        // throw is genuinely uncertain.
        let emailDispatchStarted = false;
        outcome = 'delivery_uncertain';
        try {
          const result = await awaitRefundNotificationDeadline(
            sendEmail({
              maxAttemptsPerSender: 1,
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
            lastError = null;
          } else if (result.deliveryOutcome === 'unknown') {
            outcome = 'delivery_uncertain';
            lastError = 'refund_merchant_email_unknown';
          } else {
            outcome = 'failed';
            lastError = 'refund_merchant_email_rejected';
          }
        } catch (mailError) {
          if (!emailDispatchStarted) outcome = 'failed';
          throw mailError;
        }
      }
    }
  } catch (error) {
    lastError =
      error instanceof Error ? error.message : 'refund_notification_failed';
    if (isRefundNotificationSendAdmissionRefusal(error)) {
      outcome = 'deferred';
    } else if (outcome !== 'delivery_uncertain') {
      outcome = 'failed';
    }
  }
  return { lastError, outcome };
}
