import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { fileRefundEvidenceReview } from './file-refund-evidence-review';
import { isDeterministicRefundError } from './is-deterministic-paystack-refund-error';
import { reconcilePaystackCancellationRefund } from './reconcile-paystack-cancellation-refund';

/** Recheck legacy completed refund rows before finalizing a cancelled order. */
export async function reconcileCompletedPaystackCancellationRefunds(
  supabase: SupabaseClient,
  limit = 25
): Promise<{ checked: number; failed: number }> {
  const { data, error } = await supabase
    .from('transactions')
    .select(
      'id, order_id, merchant_id, gateway_reference, amount, currency, metadata, status, cancellation_order:orders!transactions_order_id_fkey!inner(payment_status,shipping_status,cancelled_at)'
    )
    .eq('transaction_type', 'refund')
    .eq('gateway', 'paystack')
    .eq('status', 'completed')
    .in('cancellation_order.payment_status', ['paid', 'partially_paid'])
    .in('cancellation_order.shipping_status', ['cancelled', 'canceled'])
    .not('cancellation_order.cancelled_at', 'is', null)
    .order('updated_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error('completed_refund_lookup_failed');

  let failed = 0;
  for (const refund of data ?? []) {
    try {
      await reconcilePaystackCancellationRefund(supabase, refund);
    } catch (reason) {
      failed++;
      logger.warn({
        message: 'Legacy cancellation refund requires another provider check',
        refundId: refund.id,
        reason: reason instanceof Error ? reason.message : 'unknown',
      });
      if (isDeterministicRefundError(reason)) {
        // Evidence that can never verify: demote so the pending worker
        // re-tracks the row, and file the mismatch for operations instead
        // of retrying this completed row forever.
        const { error: demoteError } = await supabase
          .from('transactions')
          .update({
            status: 'refund_pending',
            updated_at: new Date().toISOString(),
          })
          .eq('id', refund.id)
          .eq('status', 'completed');
        if (demoteError) throw new Error('completed_refund_demote_failed');
        await fileRefundEvidenceReview(supabase, refund, reason.message);
        continue;
      }
      const { error: rotationError } = await supabase
        .from('transactions')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', refund.id)
        .eq('status', 'completed');
      if (rotationError) throw new Error('completed_refund_rotation_failed');
    }
  }

  return { checked: data?.length ?? 0, failed };
}
