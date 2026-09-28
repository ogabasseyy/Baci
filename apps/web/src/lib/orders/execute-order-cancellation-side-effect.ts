import type { SupabaseClient } from '@supabase/supabase-js';
import { buildOrderCancellationEmailMessage } from '@/lib/orders/build-order-cancellation-email-message';
import type { GatewayPaymentTransaction } from '@/lib/orders/gateway-payment-transaction';
import { initiatePaystackCancellationRefunds } from '@/lib/orders/initiate-paystack-cancellation-refunds';
import { isExternalPaymentGateway } from '@/lib/orders/is-external-payment-gateway';
import { quarantineRefund } from '@/lib/orders/quarantine-order-cancellation-refund';
import type { OrderCancellationSideEffectStep } from '@/lib/orders/run-order-cancellation-side-effect';
import { unsupportedRefundReasons } from '@/lib/orders/unsupported-refund-reasons';

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
  error?: string;
  messageId?: string;
  success: boolean;
};
export type CancellationEmailSender = (
  message: CancellationEmailMessage
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
    const emailResult = await sendCancellationEmail(
      buildOrderCancellationEmailMessage({
        cancelledBy: 'merchant',
        merchant,
        order,
        reason,
        refundAmount,
      })
    );
    if (!emailResult.success) {
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
    .select('metadata, status')
    .eq('order_id', order.id)
    .eq('merchant_id', order.merchant_id)
    .eq('transaction_type', 'refund')
    .order('created_at', { ascending: true });
  if (refundLookupError) {
    throw new Error('Unable to verify existing cancellation refunds');
  }
  const refundedPaymentIds = new Set(
    (refundRows ?? [])
      .filter((row) => row.status === 'completed')
      .map((row) => {
        const metadata = row.metadata;
        return metadata &&
          typeof metadata === 'object' &&
          !Array.isArray(metadata)
          ? metadata.payment_transaction_id
          : null;
      })
      .filter((id): id is string => typeof id === 'string')
  );
  const pendingRefundPaymentIds = new Set(
    (refundRows ?? [])
      .filter((row) => row.status !== 'completed')
      .map((row) => {
        const metadata = row.metadata;
        return metadata &&
          typeof metadata === 'object' &&
          !Array.isArray(metadata)
          ? metadata.payment_transaction_id
          : null;
      })
      .filter((id): id is string => typeof id === 'string')
  );
  const pendingTransactions = transactions.filter((transaction) =>
    pendingRefundPaymentIds.has(transaction.id)
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
