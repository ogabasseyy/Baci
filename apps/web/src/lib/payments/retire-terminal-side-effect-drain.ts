import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { REPLAYABLE_PAID_ORDER_SIDE_EFFECT_STEPS } from '@/lib/payments/replayable-paid-order-side-effect-steps';
import type {
  retireWedgeWithReview,
  WedgeCandidateRef,
} from '@/lib/payments/retire-wedge-with-review';

export async function retireTerminalSideEffectDrain({
  fileWedgeReview,
  orderId,
  reason,
  resolution,
  supabase,
  transaction,
}: {
  fileWedgeReview: typeof retireWedgeWithReview;
  orderId: string;
  reason: string;
  resolution: string;
  supabase: SupabaseClient;
  transaction: WedgeCandidateRef;
}): Promise<boolean> {
  const reviewFiled = await fileWedgeReview({
    candidate: transaction,
    reason,
    resolution,
    supabase,
  });
  if (!reviewFiled) {
    return false;
  }

  const { error } = await supabase
    .from('payment_side_effects')
    .update({
      claimed_at: null,
      error: 'gateway_verification_terminal',
      status: 'failed',
    })
    .eq('order_id', orderId)
    .eq('transaction_id', transaction.id)
    .in('step', [...REPLAYABLE_PAID_ORDER_SIDE_EFFECT_STEPS]);

  if (error) {
    logger.warn({
      error,
      message: 'Failed to retire terminal paid-order side-effect drain rows',
      orderId,
      transactionId: transaction.id,
    });
    return false;
  }
  return true;
}
