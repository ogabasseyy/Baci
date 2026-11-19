import type { SupabaseClient } from '@supabase/supabase-js';
import type { RefundSummary } from '@/lib/orders/refund-summary';

/**
 * Adds the persisted cancellation refund mode to a masked refund summary so
 * the card can tell a cancel-only order (the merchant refunds outside Baci)
 * from one whose automatic refund simply has not run yet. Added after the
 * mask on purpose: the mask drops unknown keys. Fails closed for the label:
 * a read problem marks the mode `unknown`, so the card says refund status is
 * unavailable instead of showing a normal state that could hide a pending
 * cancel-only refund.
 */
export async function attachCancellationRefundMode<T extends object>(
  summary: T,
  {
    merchantId,
    orderId,
    supabase,
  }: {
    merchantId: string;
    orderId: string;
    supabase: Pick<SupabaseClient, 'from'>;
  }
): Promise<T & Pick<RefundSummary, 'cancellationRefundMode'>> {
  try {
    const { data, error } = await supabase
      .from('orders')
      .select('cancellation_refund_mode')
      .eq('id', orderId)
      .eq('merchant_id', merchantId)
      .maybeSingle();
    if (error || !data)
      return { ...summary, cancellationRefundMode: 'unknown' };
    const mode = data.cancellation_refund_mode;
    return {
      ...summary,
      cancellationRefundMode:
        mode === 'manual' || mode === 'automatic' ? mode : null,
    };
  } catch {
    return { ...summary, cancellationRefundMode: 'unknown' };
  }
}
