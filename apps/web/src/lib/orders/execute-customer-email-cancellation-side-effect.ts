import { buildOrderCancellationEmailMessage } from '@/lib/orders/build-order-cancellation-email-message';
import type {
  CancellationEmailResult,
  CancellationEmailSender,
  CancellationMerchant,
  CancellationOrder,
} from '@/lib/orders/order-cancellation-side-effect-types';
import { DeliveryUncertainError } from '@/lib/orders/run-order-cancellation-side-effect';
import { assertRefundNotificationSendTime } from '@/lib/payments/assert-refund-notification-send-time';
import { awaitRefundNotificationDeadline } from '@/lib/payments/await-refund-notification-deadline';
import { zeptomailSendAdmissionBudgetMs } from '@/lib/zeptomail-send-budget';

// One transport attempt per sender: the cancellation phase cannot fit a
// full retry loop, so the next cron tick retries instead of in-process
// retries burning the phase and stranding the row delivery_uncertain.
// Shared with the drain's pre-claim budget skip: keep both call sites
// on this constant.
export const EMAIL_ATTEMPTS_PER_SENDER = 1;

export async function executeCustomerEmailCancellationSideEffect({
  deadlineMs,
  merchant,
  order,
  reason,
  sendCancellationEmail,
}: {
  deadlineMs?: number;
  merchant: CancellationMerchant;
  order: CancellationOrder;
  reason?: string;
  sendCancellationEmail?: CancellationEmailSender;
}): Promise<{ messageId: string | null }> {
  const refundAmount = Number(order.amount_paid) || 0;
  if (!sendCancellationEmail) {
    throw new Error('Cancellation email sender is required');
  }
  // Refuse the send unless a full capped attempt loop fits: the row
  // stays failed and retries on the next tick instead of stranding a
  // claim the invocation timeout would convert to delivery_uncertain.
  assertRefundNotificationSendTime(
    deadlineMs,
    zeptomailSendAdmissionBudgetMs(EMAIL_ATTEMPTS_PER_SENDER)
  );
  let emailResult: CancellationEmailResult;
  try {
    emailResult = await awaitRefundNotificationDeadline(
      sendCancellationEmail({
        ...buildOrderCancellationEmailMessage({
          cancelledBy: 'merchant',
          merchant,
          order,
          reason,
          refundAmount,
        }),
        maxAttemptsPerSender: EMAIL_ATTEMPTS_PER_SENDER,
        ...(deadlineMs !== undefined && {
          signal: AbortSignal.timeout(
            Math.max(1, deadlineMs - Date.now() - 10_000)
          ),
          // Match the signal's 10s buffer: the platform-sender
          // fallback declines unless its own attempt fits.
          fallbackDeadlineMs: deadlineMs - 10_000,
        }),
      }),
      deadlineMs
    );
  } catch (error) {
    // A thrown mail call has unknown delivery outcome; do not auto-retry it.
    throw new DeliveryUncertainError(
      `cancellation_email_send_failed: ${error instanceof Error ? error.message : 'unknown'}`
    );
  }
  if (!emailResult.success) {
    if (emailResult.deliveryOutcome === 'unknown') {
      throw new DeliveryUncertainError(
        emailResult.error || 'cancellation_email_unknown'
      );
    }
    throw new Error(emailResult.error || 'Failed to send email');
  }
  return { messageId: emailResult.messageId ?? null };
}
