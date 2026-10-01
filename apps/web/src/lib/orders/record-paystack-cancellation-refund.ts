import type { SupabaseClient } from '@supabase/supabase-js';
import type { initiateRefund as initiatePaystackRefund } from '@/lib/initiate-paystack-refund';
import type { GatewayPaymentTransaction } from '@/lib/orders/gateway-payment-transaction';
import { quarantineRefund } from '@/lib/orders/quarantine-order-cancellation-refund';

type RefundSuccess = Extract<
  Awaited<ReturnType<typeof initiatePaystackRefund>>,
  { success: true }
>;

/**
 * Audit an accepted provider refund before the next leg runs, returning
 * the provider refund ID. A reply whose payment evidence does not match
 * the leg quarantines delivery-uncertain (the provider may hold money
 * no reconciler can attribute); an unauditable accept also quarantines
 * with the provider ID persisted in the review. Both quarantine paths
 * throw, so a return means the leg is durably recorded.
 */
export async function recordPaystackCancellationRefund({
  order,
  paystackRefund,
  reason,
  supabase,
  transaction,
  transactionAmount,
}: {
  order: {
    currency: string | null;
    id: string;
    merchant_id: string;
    order_number: string | null;
  };
  paystackRefund: RefundSuccess;
  reason?: string;
  supabase: Pick<SupabaseClient, 'from' | 'rpc'>;
  transaction: GatewayPaymentTransaction;
  transactionAmount: number;
}): Promise<number> {
  const providerStatus = String(paystackRefund.data.status ?? '')
    .trim()
    .toLowerCase();
  // A failed/needs-attention verdict must NOT be pre-populated: the
  // record RPC treats an equal metadata verdict as a repeat and
  // returns before transitioning the row or queuing the failure
  // notification — and the side effect has already completed, so
  // polling would only rotate the permanently pending row. Leave it
  // unset so the first reconcile applies the transition; later polls
  // repeat no-op correctly once the RPC has persisted it.
  const failedVerdict =
    providerStatus === 'failed' || providerStatus === 'needs-attention';
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
            ...(failedVerdict
              ? {}
              : { provider_refund_status: providerStatus }),
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
  const { error: insertTxError } = await supabase.from('transactions').insert({
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
      ...(failedVerdict ? {} : { provider_refund_status: providerStatus }),
    },
  });
  if (insertTxError) {
    let recordedByAnotherWriter = false;
    if (insertTxError.code === '23505') {
      // A concurrent webhook recovery may have recorded this refund —
      // but the unique index spans all transaction types and gateways,
      // so a collision alone proves nothing. Only treat the refund as
      // recorded after verifying the winning row is this provider
      // refund for this payment leg: a legacy or corrupt row reusing
      // the provider refund ID on another leg must not mark this leg
      // audited while its own refund is never initiated.
      const { data: conflicting, error: conflictLookupError } = await supabase
        .from('transactions')
        .select(
          'id, transaction_type, gateway, gateway_reference, amount, currency, metadata'
        )
        .eq('order_id', order.id)
        .eq('gateway_reference', String(paystackRefund.data.id))
        .maybeSingle();
      const conflictingLeg = (
        conflicting?.metadata as
          | { payment_transaction_id?: unknown }
          | null
          | undefined
      )?.payment_transaction_id;
      recordedByAnotherWriter =
        !conflictLookupError &&
        conflicting?.transaction_type === 'refund' &&
        conflicting?.gateway === 'paystack' &&
        conflicting?.gateway_reference === String(paystackRefund.data.id) &&
        conflictingLeg === transaction.id &&
        Number(conflicting?.amount) === transactionAmount &&
        conflicting?.currency ===
          (transaction.currency || order.currency || 'NGN');
    }
    if (!recordedByAnotherWriter) {
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
  }
  return paystackRefund.data.id;
}
