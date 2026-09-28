import type { SupabaseClient } from '@supabase/supabase-js';
import { initiateRefund as initiatePaystackRefund } from '@/lib/initiate-paystack-refund';
import type { GatewayPaymentTransaction } from '@/lib/orders/gateway-payment-transaction';
import { quarantineRefund } from '@/lib/orders/quarantine-order-cancellation-refund';
import { DeliveryUncertainError } from '@/lib/orders/run-order-cancellation-side-effect';

/**
 * Initiate a Paystack refund for every gateway leg that has no recorded
 * completed refund, auditing each accepted refund before moving on. Returns
 * the accepted provider refund IDs. Throws on the first leg that cannot
 * proceed; quarantine paths file a reconciliation review first.
 */
export async function initiatePaystackCancellationRefunds({
  order,
  reason,
  refundedPaymentIds,
  supabase,
  transactions,
}: {
  order: {
    currency: string | null;
    id: string;
    merchant_id: string;
    order_number: string | null;
  };
  reason?: string;
  refundedPaymentIds: Set<string>;
  supabase: Pick<SupabaseClient, 'from' | 'rpc'>;
  transactions: GatewayPaymentTransaction[];
}): Promise<number[]> {
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
      if (refundIds.length > 0) {
        await quarantineRefund({
          metadata: {
            accepted_refund_ids: refundIds,
            failed_payment_transaction_id: transaction.id,
          },
          order,
          reason:
            'Some payment legs were accepted for refund, but a later leg failed',
          supabase,
          transactions: [transaction],
        });
      } else if (isAmbiguousFailure) {
        // No local refund row exists and the provider may still have accepted
        // this first attempt, so file the affected leg for operations before
        // quarantining; otherwise no reconciler could ever discover it.
        await quarantineRefund({
          metadata: {
            failed_payment_transaction_id: transaction.id,
          },
          order,
          reason:
            'Paystack refund initiation failed ambiguously and may already exist for this payment leg',
          supabase,
          transactions: [transaction],
        });
      }
      const RefundError = isAmbiguousFailure ? DeliveryUncertainError : Error;
      throw new RefundError(paystackRefund.error);
    }

    const providerStatus = String(paystackRefund.data.status ?? '')
      .trim()
      .toLowerCase();
    const providerTransaction = paystackRefund.data.transaction;
    const providerPaymentId =
      typeof providerTransaction === 'number'
        ? providerTransaction
        : providerTransaction?.id;
    if (
      !Number.isSafeInteger(paystackRefund.data.id) ||
      paystackRefund.data.id <= 0 ||
      !Number.isSafeInteger(providerPaymentId) ||
      providerPaymentId <= 0 ||
      (typeof providerTransaction !== 'number' &&
        providerTransaction?.reference !== transaction.gateway_reference)
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
            status: 'refund_pending',
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
              // Deliberately unheld: if the quarantine review below fails
              // transiently, the polling reconciler must still discover
              // this row, re-verify it, and file the review itself.
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
        status: 'refund_pending',
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
      // The provider accepted this refund but no local row exists, so the
      // webhook and polling reconcilers cannot discover it. Persist the
      // provider ID in the review before quarantining.
      await quarantineRefund({
        metadata: {
          provider_refund_id: paystackRefund.data.id,
          payment_transaction_id: transaction.id,
          audit_record_failed: true,
        },
        order,
        reason: 'Paystack accepted refund but its local audit record failed',
        supabase,
        transactions: [transaction],
      });
    }
    refundIds.push(paystackRefund.data.id);
  }
  return refundIds;
}
