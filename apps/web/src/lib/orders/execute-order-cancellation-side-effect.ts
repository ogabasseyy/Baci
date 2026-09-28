import type { SupabaseClient } from '@supabase/supabase-js';
import { buildOrderCancellationEmailMessage } from '@/lib/orders/build-order-cancellation-email-message';
import type { GatewayPaymentTransaction } from '@/lib/orders/gateway-payment-transaction';
import { initiatePaystackCancellationRefunds } from '@/lib/orders/initiate-paystack-cancellation-refunds';
import { isExternalPaymentGateway } from '@/lib/orders/is-external-payment-gateway';
import { quarantineRefund } from '@/lib/orders/quarantine-order-cancellation-refund';
import {
  DeliveryUncertainError,
  type OrderCancellationSideEffectStep,
} from '@/lib/orders/run-order-cancellation-side-effect';
import { unsupportedRefundReasons } from '@/lib/orders/unsupported-refund-reasons';
import { assertRefundNotificationSendTime } from '@/lib/payments/assert-refund-notification-send-time';
import { awaitRefundNotificationDeadline } from '@/lib/payments/await-refund-notification-deadline';

type CancellationOrder = Parameters<
  typeof buildOrderCancellationEmailMessage
>[0]['order'] & {
  currency: string | null;
  merchant_id: string;
  payment_status: string;
};

type CancellationMerchant = Parameters<
  typeof buildOrderCancellationEmailMessage
>[0]['merchant'];
type CancellationEmailMessage = ReturnType<
  typeof buildOrderCancellationEmailMessage
>;
type CancellationEmailResult = {
  deliveryOutcome?: 'unknown';
  error?: string;
  messageId?: string;
  success: boolean;
};
export type CancellationEmailSender = (
  message: CancellationEmailMessage & { signal?: AbortSignal }
) => Promise<CancellationEmailResult>;

export async function executeOrderCancellationSideEffect({
  deadlineMs,
  merchant,
  order,
  reason,
  sendCancellationEmail,
  step,
  supabase,
}: {
  deadlineMs?: number;
  merchant: CancellationMerchant;
  order: CancellationOrder;
  reason?: string;
  sendCancellationEmail?: CancellationEmailSender;
  step: OrderCancellationSideEffectStep;
  supabase: Pick<SupabaseClient, 'from' | 'rpc'>;
}): Promise<{ messageId: string | null } | { refundIds: number[] }> {
  const refundAmount = Number(order.amount_paid) || 0;
  if (step === 'customer_email') {
    if (!sendCancellationEmail) {
      throw new Error('Cancellation email sender is required');
    }
    // Refuse the send when too little cron budget remains: the row stays
    // failed and retries on the next tick instead of stranding a claim the
    // invocation timeout would convert to delivery_uncertain.
    assertRefundNotificationSendTime(deadlineMs);
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
          ...(deadlineMs !== undefined && {
            signal: AbortSignal.timeout(
              Math.max(1, deadlineMs - Date.now() - 10_000)
            ),
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

  const { data: transactionRows, error: transactionError } = await supabase
    .from('transactions')
    .select('id, amount, currency, gateway, gateway_reference')
    .eq('order_id', order.id)
    .eq('merchant_id', order.merchant_id)
    .eq('transaction_type', 'payment')
    .eq('status', 'completed')
    .order('created_at', { ascending: true });
  if (transactionError || !transactionRows?.length) {
    throw new Error('No completed payment transaction found');
  }
  const transactions = (transactionRows as GatewayPaymentTransaction[]).filter(
    (transaction) => isExternalPaymentGateway(transaction.gateway)
  );
  if (!transactions.length) {
    throw new Error('No completed gateway payment transaction found');
  }
  const unsupportedLegs = transactions.filter(
    (transaction) =>
      transaction.gateway !== 'paystack' || !transaction.gateway_reference
  );
  if (unsupportedLegs.length > 0) {
    const unsupportedReasons = unsupportedRefundReasons(unsupportedLegs);
    await quarantineRefund({
      order,
      preflight: true,
      reason: `Automatic cancellation refund requires review: ${unsupportedReasons.join(', ')}`,
      supabase,
      transactions,
    });
  }
  const gatewayRefundAmount = transactions.reduce(
    (total, transaction) => total + (Number(transaction.amount) || 0),
    0
  );
  if (
    gatewayRefundAmount <= 0 ||
    transactions.some((transaction) => Number(transaction.amount) <= 0)
  ) {
    throw new Error('Completed payment transaction has no refundable amount');
  }
  const { data: refundRows, error: refundLookupError } = await supabase
    .from('transactions')
    .select('gateway_reference, metadata, status')
    .eq('order_id', order.id)
    .eq('merchant_id', order.merchant_id)
    .eq('transaction_type', 'refund')
    .order('created_at', { ascending: true });
  if (refundLookupError) {
    throw new Error('Unable to verify existing cancellation refunds');
  }
  const linkedPaymentId = (row: { metadata: unknown }): string | null => {
    const metadata = row.metadata as {
      payment_transaction_id?: unknown;
    } | null;
    const paymentId = metadata?.payment_transaction_id;
    return typeof paymentId === 'string' &&
      transactions.some((transaction) => transaction.id === paymentId)
      ? paymentId
      : null;
  };
  const unlinkedRefunds = (refundRows ?? []).filter(
    (row) => linkedPaymentId(row) === null
  );
  if (unlinkedRefunds.length > 0) {
    await quarantineRefund({
      metadata: { unlinked_refund_count: unlinkedRefunds.length },
      order,
      preflight: true,
      reason:
        'An existing refund cannot be linked to a payment leg; verify it before another provider refund',
      supabase,
      transactions,
    });
  }
  const refundedPaymentIds = new Set(
    (refundRows ?? [])
      .filter((row) => row.status === 'completed')
      .map(linkedPaymentId)
      .filter((id): id is string => typeof id === 'string')
  );
  // Legs with a provider-accepted audit row are still in flight: the
  // reconciler completes them and the drain resumes the remaining legs.
  // Only legs without provider evidence (failed or ambiguous rows) need a
  // terminal quarantine review.
  const awaitingRefundPaymentIds = new Set<string>();
  const reviewRefundPaymentIds = new Set<string>();
  for (const row of refundRows ?? []) {
    if (row.status === 'completed') continue;
    const paymentId = linkedPaymentId(row);
    if (typeof paymentId !== 'string') continue;
    if (
      row.status === 'refund_pending' &&
      typeof row.gateway_reference === 'string' &&
      /^[1-9][0-9]*$/.test(row.gateway_reference)
    ) {
      awaitingRefundPaymentIds.add(paymentId);
    } else {
      reviewRefundPaymentIds.add(paymentId);
    }
  }
  const pendingTransactions = transactions.filter((transaction) =>
    reviewRefundPaymentIds.has(transaction.id)
  );
  if (pendingTransactions.length > 0) {
    await quarantineRefund({
      order,
      preflight: true,
      reason: 'A previously accepted cancellation refund is not terminal',
      supabase,
      transactions: pendingTransactions,
    });
  }
  const awaitingTransactions = transactions.filter(
    (transaction) =>
      awaitingRefundPaymentIds.has(transaction.id) &&
      !refundedPaymentIds.has(transaction.id)
  );
  if (awaitingTransactions.length > 0) {
    throw new Error('cancellation_refund_awaiting_provider_completion');
  }
  const refundIds = await initiatePaystackCancellationRefunds({
    deadlineMs,
    order,
    reason,
    refundedPaymentIds,
    supabase,
    transactions,
  });
  return { refundIds };
}
