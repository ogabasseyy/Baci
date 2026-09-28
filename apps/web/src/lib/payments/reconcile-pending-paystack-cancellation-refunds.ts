import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { fileRefundEvidenceReview } from './file-refund-evidence-review';
import { holdPaystackRefundForReview } from './hold-paystack-refund-for-review';
import { isDeterministicRefundError } from './is-deterministic-paystack-refund-error';
import type { RefundRow } from './paystack-cancellation-refund-row';
import { reconcilePaystackCancellationRefund } from './reconcile-paystack-cancellation-refund';

export async function reconcilePendingPaystackCancellationRefunds(
  supabase: SupabaseClient,
  limit = 25
): Promise<{ checked: number; failed: number }> {
  const { data, error } = await supabase
    .from('transactions')
    .select(
      'id, order_id, merchant_id, gateway_reference, amount, currency, metadata, status, cancelled_order:orders!transactions_order_id_fkey!inner(cancelled_at)'
    )
    .eq('transaction_type', 'refund')
    .eq('gateway', 'paystack')
    .in('status', ['refund_pending', 'pending'])
    .is('metadata->>refund_reconciliation_hold', null)
    // Only cancellation refunds: the order must be cancelled and the row
    // must carry the cancellation audit description. Unrelated pending
    // refunds would fail verification with an order mismatch and get
    // held out of their own recovery path.
    .not('cancelled_order.cancelled_at', 'is', null)
    .like('description', 'Refund for cancelled order #%')
    .order('updated_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error('pending_refund_lookup_failed');
  let failed = 0;
  for (const refund of data ?? []) {
    try {
      await reconcilePaystackCancellationRefund(supabase, refund as RefundRow);
    } catch (reason) {
      failed++;
      logger.warn({
        message: 'Paystack cancellation refund check requires another attempt',
        refundId: refund.id,
        orderId: refund.order_id,
        reason: reason instanceof Error ? reason.message : 'unknown',
      });
      // Rotate an unavailable or mismatched provider row so it cannot starve
      // every newer pending refund in this bounded cron batch.
      const { error: rotationError } = await supabase
        .from('transactions')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', refund.id)
        .in('status', ['refund_pending', 'pending']);
      if (rotationError) throw new Error('pending_refund_rotation_failed');
      if (isDeterministicRefundError(reason)) {
        await fileRefundEvidenceReview(
          supabase,
          refund as RefundRow,
          reason.message
        );
        await holdPaystackRefundForReview(supabase, refund.id, reason.message);
      }
    }
  }
  return { checked: data?.length ?? 0, failed };
}
