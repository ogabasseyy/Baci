import {
  awaitRefundNotificationDeadline,
  REFUND_NOTIFICATION_DELIVERY_DEADLINE,
} from './await-refund-notification-deadline';
import type {
  MerchantRefundPushSender,
  RefundNotificationOutcome,
} from './deliver-claimed-refund-notification';

/**
 * Attempt one merchant refund push and classify its outcome. A rejection
 * means provider dispatch never started (see the MerchantRefundPushSender
 * contract), so it is a retryable failure and the caller still runs the
 * merchant-email fallback — unlike the email senders, whose throws are
 * ambiguous and stay delivery_uncertain. Only an explicit unknown result
 * (or the deadline firing with dispatch possibly in flight) terminalizes
 * as delivery_uncertain, skipping fallback and retry. Production
 * `notifyMerchant` satisfies the contract: chunk and delivery errors
 * resolve (unknown only after dispatch starts) and its audit write
 * never throws, so every rejection escapes before any Expo request.
 */
export async function attemptMerchantRefundPush({
  body,
  completed,
  deadlineMs,
  merchantId,
  orderId,
  orderNumber,
  sendMerchantPush,
  title,
}: {
  body: string;
  completed: boolean;
  deadlineMs?: number;
  merchantId: string;
  orderId: string;
  orderNumber: string;
  sendMerchantPush: MerchantRefundPushSender;
  title: string;
}): Promise<{
  lastError: string | null;
  outcome: RefundNotificationOutcome;
}> {
  let pushed: Awaited<ReturnType<MerchantRefundPushSender>>;
  try {
    pushed = await awaitRefundNotificationDeadline(
      sendMerchantPush(
        merchantId,
        title,
        body,
        {
          type: completed
            ? 'paystack_refund_processed'
            : 'paystack_refund_needs_attention',
          order_id: orderId,
          order_number: orderNumber,
        },
        'payments'
      ),
      deadlineMs
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === REFUND_NOTIFICATION_DELIVERY_DEADLINE
    ) {
      return { lastError: error.message, outcome: 'delivery_uncertain' };
    }
    return {
      lastError:
        error instanceof Error ? error.message : 'refund_merchant_push_failed',
      outcome: 'failed',
    };
  }
  if (
    pushed.deliveryOutcome === 'unknown' ||
    (pushed.sent > 0 && (pushed.failed > 0 || pushed.errors.length > 0))
  ) {
    return {
      lastError: 'refund_merchant_push_uncertain',
      outcome: 'delivery_uncertain',
    };
  }
  if (pushed.sent > 0) return { lastError: null, outcome: 'sent' };
  return { lastError: 'refund_merchant_push_failed', outcome: 'failed' };
}
