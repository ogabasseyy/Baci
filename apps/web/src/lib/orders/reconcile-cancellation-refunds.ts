import type { SupabaseClient } from '@supabase/supabase-js';
import { listPaystackRefunds } from './list-paystack-refunds';

export async function reconcileCancellationRefunds(
  supabase: SupabaseClient
): Promise<void> {
  const { data: refunds, error } = await supabase
    .from('transactions')
    .select(
      'id, order_id, merchant_id, amount, currency, gateway_reference, metadata, orders!inner(shipping_status)'
    )
    .eq('transaction_type', 'refund')
    .eq('gateway', 'paystack')
    .eq('status', 'pending')
    .in('orders.shipping_status', ['cancelled', 'canceled'])
    .order('updated_at')
    .limit(10);
  if (error) throw new Error('Unable to load pending cancellation refunds');
  for (const refund of refunds ?? []) {
    try {
      const paymentId = refund.metadata?.payment_transaction_id;
      if (typeof paymentId !== 'string') continue;
      const payment = await supabase
        .from('transactions')
        .select('gateway_reference')
        .eq('id', paymentId)
        .eq('order_id', refund.order_id)
        .eq('merchant_id', refund.merchant_id)
        .eq('transaction_type', 'payment')
        .eq('status', 'completed')
        .eq('gateway', 'paystack')
        .single();
      if (payment.error || !payment.data?.gateway_reference) continue;
      const rows = await listPaystackRefunds(payment.data.gateway_reference);
      const row = rows.find(
        (item) => String(item.id) === refund.gateway_reference
      );
      if (
        !row ||
        row.amount !== Math.round(Number(refund.amount) * 100) ||
        row.currency !== refund.currency ||
        !['processed', 'failed'].includes(row.status)
      )
        continue;
      const update = await supabase
        .from('transactions')
        .update({
          status: row.status === 'processed' ? 'completed' : 'failed',
          updated_at: new Date().toISOString(),
          metadata: { ...refund.metadata, provider_refund_status: row.status },
        })
        .eq('id', refund.id)
        .eq('status', 'pending')
        .eq('merchant_id', refund.merchant_id);
      if (update.error) continue;
      const order = await supabase
        .from('orders')
        .select('payment_status')
        .eq('id', refund.order_id)
        .eq('merchant_id', refund.merchant_id)
        .single();
      if (order.error) continue;
      if (order.data?.payment_status !== 'refunded') {
        const remaining = await supabase
          .from('transactions')
          .select('id')
          .eq('order_id', refund.order_id)
          .eq('merchant_id', refund.merchant_id)
          .eq('transaction_type', 'refund')
          .not('status', 'in', '(completed,failed)')
          .limit(1);
        if (remaining.error || remaining.data?.length) continue;
        const requeue = await supabase
          .from('order_cancellation_side_effects')
          .update({
            status: 'failed',
            error:
              row.status === 'failed'
                ? 'Paystack refund failed; ready to retry'
                : 'Remaining refund ready to retry',
            attempts: 0,
          })
          .eq('order_id', refund.order_id)
          .eq('merchant_id', refund.merchant_id)
          .eq('step', 'refund')
          .eq('status', 'delivery_uncertain')
          .like('error', 'Paystack accepted refund%');
        if (requeue.error) continue;
      }
      if (order.data?.payment_status !== 'refunded') continue;
      const finish = await supabase
        .from('order_cancellation_side_effects')
        .update({
          status: 'completed',
          error: null,
          completed_at: new Date().toISOString(),
        })
        .eq('order_id', refund.order_id)
        .eq('merchant_id', refund.merchant_id)
        .eq('step', 'refund')
        .eq('status', 'delivery_uncertain');
      if (finish.error)
        throw new Error('Unable to finish refund reconciliation');
    } catch {
      // Provider uncertainty never permits a new submission. Keep the record
      // for the next reconciliation pass or operator review.
    }
  }
}
