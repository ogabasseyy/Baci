import type { SupabaseClient } from '@supabase/supabase-js';
import { selectPaystackRefundReference } from '@/lib/select-paystack-refund-reference';
import { fileReferenceOnlyPaystackRefundReview } from './file-reference-only-paystack-refund-review';
import { fileRefundEvidenceReview } from './file-refund-evidence-review';
import { holdPaystackRefundForReview } from './hold-paystack-refund-for-review';
import { isDeterministicRefundError } from './is-deterministic-paystack-refund-error';
import type { RefundRow } from './paystack-cancellation-refund-row';
import { reconcilePaystackCancellationRefund } from './reconcile-paystack-cancellation-refund';

export async function reconcilePaystackRefundEvent(
  supabase: SupabaseClient,
  transactionReference: string
): Promise<void> {
  // Share the webhook reference alphabet: the caller already selected
  // this reference with the same validator, so only unusable values return.
  if (
    selectPaystackRefundReference(transactionReference, undefined) !==
    transactionReference
  )
    return;
  const { data: payments, error: paymentError } = await supabase
    .from('transactions')
    .select(
      'id, order_id, merchant_id, amount, currency, cancel_order:orders!transactions_order_id_fkey(cancelled_at,shipping_status)'
    )
    .eq('gateway', 'paystack')
    .eq('gateway_reference', transactionReference)
    .eq('transaction_type', 'payment')
    .eq('status', 'completed')
    .limit(10);
  if (paymentError) throw new Error('refund_event_payment_lookup_failed');
  for (const payment of payments ?? []) {
    if (!payment.order_id) continue;
    // Mirror the ID handler's cancellation gate: a reference-only event
    // for a non-cancelled order must not reach the cancellation-only
    // reconciler, which would reject it and file an unrelated review.
    const cancelOrder = (
      payment as {
        cancel_order?: {
          cancelled_at?: string | null;
          shipping_status?: string | null;
        } | null;
      }
    ).cancel_order;
    if (
      cancelOrder?.cancelled_at == null ||
      (cancelOrder.shipping_status !== 'cancelled' &&
        cancelOrder.shipping_status !== 'canceled')
    ) {
      continue;
    }
    const { data: refunds, error } = await supabase
      .from('transactions')
      .select(
        'id, order_id, merchant_id, gateway_reference, amount, currency, metadata, status'
      )
      .eq('order_id', payment.order_id)
      .eq('merchant_id', payment.merchant_id)
      .eq('transaction_type', 'refund')
      .eq('gateway', 'paystack')
      .eq('metadata->>payment_transaction_id', payment.id)
      // A new signed provider event may resolve a held refund. Only polling
      // excludes review holds; the provider read still verifies all evidence.
      .in('status', ['refund_pending', 'pending', 'failed'])
      .limit(10);
    if (error) throw new Error('refund_event_lookup_failed');
    if ((refunds ?? []).length === 0) {
      // No in-flight local row: either a late duplicate of an
      // already-reconciled refund (stays silent) or a provider refund
      // with no local audit row at all, which polling can never
      // rediscover — that fails closed with a durable review.
      const paymentRow = payment as {
        amount: number | string | null;
        currency: string | null;
        id: string;
        merchant_id: string;
        order_id: string;
      };
      await fileReferenceOnlyPaystackRefundReview(supabase, {
        amount: Number(paymentRow.amount) || 0,
        currency: paymentRow.currency ?? 'NGN',
        merchantId: paymentRow.merchant_id,
        orderId: paymentRow.order_id,
        paymentId: paymentRow.id,
        // The query selected this payment by reference, so it identifies
        // the leg even when the stored row omits it.
        paymentReference: transactionReference,
      });
    }
    for (const refund of refunds ?? []) {
      try {
        await reconcilePaystackCancellationRefund(
          supabase,
          refund as RefundRow
        );
      } catch (reason) {
        if (!isDeterministicRefundError(reason)) throw reason;
        await fileRefundEvidenceReview(
          supabase,
          refund as RefundRow,
          reason.message
        );
        await holdPaystackRefundForReview(supabase, refund.id, reason.message);
      }
    }
  }
}
