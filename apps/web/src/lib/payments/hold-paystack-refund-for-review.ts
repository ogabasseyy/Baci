import type { SupabaseClient } from '@supabase/supabase-js';

export async function holdPaystackRefundForReview(
  supabase: SupabaseClient,
  refundId: string,
  reason: string
): Promise<void> {
  const { data, error } = await supabase.rpc(
    'hold_paystack_cancellation_refund_for_review_v1',
    { p_refund_id: refundId, p_reason: reason }
  );
  if (error || data !== true) throw new Error('refund_review_hold_failed');
}
