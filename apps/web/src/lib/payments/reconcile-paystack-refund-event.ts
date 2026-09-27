import type { SupabaseClient } from '@supabase/supabase-js';
import { fileRefundEvidenceReview } from './file-refund-evidence-review';
import { holdPaystackRefundForReview } from './hold-paystack-refund-for-review';
import { isDeterministicRefundError } from './is-deterministic-paystack-refund-error';
import type { RefundRow } from './paystack-cancellation-refund-row';
import { reconcilePaystackCancellationRefund } from './reconcile-paystack-cancellation-refund';

export async function reconcilePaystackRefundEvent(
  supabase: SupabaseClient,
  transactionReference: string
): Promise<void> {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(transactionReference)) return;
  const { data: payments, error: paymentError } = await supabase
    .from('transactions')
    .select('id, order_id, merchant_id')
    .eq('gateway', 'paystack')
    .eq('gateway_reference', transactionReference)
    .eq('transaction_type', 'payment')
    .eq('status', 'completed')
    .limit(10);
  if (paymentError) throw new Error('refund_event_payment_lookup_failed');
  for (const payment of payments ?? []) {
    if (!payment.order_id) continue;
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
