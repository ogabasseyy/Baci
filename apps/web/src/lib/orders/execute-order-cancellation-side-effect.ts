import type { SupabaseClient } from '@supabase/supabase-js';
import { buildOrderCancellationEmailMessage } from '@/lib/orders/build-order-cancellation-email-message';
import {
  DeliveryUncertainError,
  type OrderCancellationSideEffectStep,
} from '@/lib/orders/run-order-cancellation-side-effect';
import { initiateRefund as initiatePaystackRefund } from '@/lib/paystack';

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

interface GatewayPaymentTransaction {
  amount: number;
  currency: string | null;
  gateway: string | null;
  gateway_reference: string | null;
  id: string;
}

const INTERNAL_PAYMENT_GATEWAYS = new Set([
  'wallet',
  'savings',
  'store_credit',
  'cash',
  'manual',
  'pay_on_delivery',
]);

async function quarantineRefund({
  metadata,
  order,
  reason,
  supabase,
  transactions,
}: {
  metadata?: Record<string, unknown>;
  order: CancellationOrder;
  reason: string;
  supabase: Pick<SupabaseClient, 'from'>;
  transactions: GatewayPaymentTransaction[];
}): Promise<never> {
  const firstTransaction = transactions[0];
  const { error: reviewError } = await supabase
    .from('reconciliation_review')
    .insert({
      candidates: transactions.map((transaction) => ({
        amount: Number(transaction.amount),
        currency: transaction.currency ?? order.currency ?? 'NGN',
        gateway: transaction.gateway,
        gatewayReference: transaction.gateway_reference,
        paymentTransactionId: transaction.id,
      })),
      issue_type: 'order_cancellation_refund_requires_review',
      merchant_id: order.merchant_id,
      metadata: metadata ?? {},
      order_id: order.id,
      paystack_ref: firstTransaction?.gateway_reference ?? null,
      reason,
      txn_id: firstTransaction?.id ?? null,
    });
  const duplicateReview =
    (reviewError as { code?: string } | null)?.code === '23505';
  if (reviewError && !duplicateReview) {
    // The provider may already have accepted the refund. A failed review write
    // must not turn this into a retryable provider call.
    throw new DeliveryUncertainError(
      'Refund requires reconciliation, but filing the review failed'
    );
  }
  throw new DeliveryUncertainError(reason);
}

export async function executeOrderCancellationSideEffect({
  merchant,
  order,
  reason,
  sendCancellationEmail,
  step,
  supabase,
}: {
  merchant: CancellationMerchant;
  order: CancellationOrder;
  reason?: string;
  sendCancellationEmail?: CancellationEmailSender;
  step: OrderCancellationSideEffectStep;
  supabase: Pick<SupabaseClient, 'from'>;
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
    (transaction) =>
      !transaction.gateway ||
      !INTERNAL_PAYMENT_GATEWAYS.has(transaction.gateway)
  );
  if (!transactions.length) {
    throw new Error('No completed gateway payment transaction found');
  }
  const unsupportedLegs = transactions.filter(
    (transaction) =>
      transaction.gateway !== 'paystack' || !transaction.gateway_reference
  );
  if (unsupportedLegs.length > 0) {
    const unsupportedReasons = [
      ...new Set(
        unsupportedLegs.map((transaction) => {
          if (!transaction.gateway) return 'missing gateway';
          if (!transaction.gateway_reference) {
            return `${transaction.gateway} missing reference`;
          }
          return transaction.gateway;
        })
      ),
    ];
    await quarantineRefund({
      order,
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
      reason: 'A previously accepted cancellation refund is not terminal',
      supabase,
      transactions: pendingTransactions,
    });
  }
  const refundIds: number[] = [];

  for (const transaction of transactions) {
    if (refundedPaymentIds.has(transaction.id)) continue;
    const transactionAmount = Number(transaction.amount);
    const paystackRefund = await initiatePaystackRefund(
      transaction.gateway_reference as string,
      Math.round(transactionAmount * 100),
      reason || 'Order cancelled'
    );
    if (!paystackRefund.success) {
      const isAmbiguousFailure =
        paystackRefund.code === 'NETWORK_ERROR' ||
        paystackRefund.code?.startsWith('HTTP_5');
      const RefundError = isAmbiguousFailure ? DeliveryUncertainError : Error;
      throw new RefundError(paystackRefund.error);
    }

    const providerStatus = String(paystackRefund.data.status ?? '')
      .trim()
      .toLowerCase();
    const refundCompleted = providerStatus === 'processed';
    const providerPaymentId = paystackRefund.data.transaction?.id;
    if (
      !Number.isSafeInteger(paystackRefund.data.id) ||
      paystackRefund.data.id <= 0 ||
      !Number.isSafeInteger(providerPaymentId) ||
      providerPaymentId <= 0 ||
      paystackRefund.data.transaction?.reference !==
        transaction.gateway_reference
    ) {
      if (
        Number.isSafeInteger(paystackRefund.data.id) &&
        paystackRefund.data.id > 0
      ) {
        const { error: uncertainInsertError } = await supabase
          .from('transactions')
          .insert({
            merchant_id: order.merchant_id,
            order_id: order.id,
            transaction_type: 'refund',
            amount: transactionAmount,
            currency: transaction.currency || order.currency || 'NGN',
            status: 'pending',
            gateway: 'paystack',
            gateway_reference: String(paystackRefund.data.id),
            description: `Refund for cancelled order #${order.order_number || order.id.slice(0, 8)}`,
            metadata: {
              cancellation_reason: reason ?? null,
              payment_transaction_id: transaction.id,
              provider_payment_transaction_id:
                Number.isSafeInteger(providerPaymentId) && providerPaymentId > 0
                  ? providerPaymentId
                  : null,
              provider_refund_status: providerStatus,
              refund_reconciliation_hold: 'provider_creation_evidence_mismatch',
            },
          });
        if (uncertainInsertError) {
          await quarantineRefund({
            metadata: {
              provider_refund_id: paystackRefund.data.id,
              payment_transaction_id: transaction.id,
              audit_record_failed: true,
            },
            order,
            reason:
              'Paystack accepted refund but its uncertain audit row could not be recorded',
            supabase,
            transactions: [transaction],
          });
        }
      }
      // quarantineRefund throws DeliveryUncertainError. The surrounding
      // runOrderCancellationSideEffect persists delivery_uncertain, and its
      // claim RPC refuses a second provider call until manual reconciliation.
      await quarantineRefund({
        metadata: {
          provider_refund_id: paystackRefund.data.id,
          payment_transaction_id: transaction.id,
        },
        order,
        reason: 'Paystack accepted refund without matching payment evidence',
        supabase,
        transactions: [transaction],
      });
    }
    const { error: insertTxError } = await supabase
      .from('transactions')
      .insert({
        merchant_id: order.merchant_id,
        order_id: order.id,
        transaction_type: 'refund',
        amount: transactionAmount,
        currency: transaction.currency || order.currency || 'NGN',
        // Fetch Refund independently verifies even an immediate processed reply.
        status: 'pending',
        gateway: transaction.gateway,
        gateway_reference: String(paystackRefund.data.id),
        description: `Refund for cancelled order #${order.order_number || order.id.slice(0, 8)}`,
        metadata: {
          cancellation_reason: reason ?? null,
          payment_transaction_id: transaction.id,
          provider_payment_transaction_id: providerPaymentId,
          provider_refund_status: providerStatus,
        },
      });
    if (insertTxError) {
      throw new DeliveryUncertainError(
        'Refund succeeded but its local audit record failed'
      );
    }
    if (!refundCompleted) {
      await quarantineRefund({
        metadata: {
          payment_transaction_id: transaction.id,
          provider_refund_id: paystackRefund.data.id,
          provider_refund_status: providerStatus,
        },
        order,
        reason: `Paystack accepted refund ${paystackRefund.data.id} with nonterminal status ${providerStatus || 'missing'}`,
        supabase,
        transactions: [transaction],
      });
    }
    refundIds.push(paystackRefund.data.id);
  }
  return { refundIds };
}
