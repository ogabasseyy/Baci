import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrderCancellationSideEffectStep } from './run-order-cancellation-side-effect';

/**
 * Reset the order-level attempt budget so a resumed run retries
 * outstanding legs fresh instead of mistaking their first failure for
 * exhaustion. Returns true when the reset did NOT land — Supabase
 * resolves write failures instead of throwing — so callers that defer
 * on a fresh budget can file exhaustion evidence instead of leaving
 * the resumed leg capped at five attempts with no review.
 */
export async function tryResetCancellationSideEffectAttempts(
  supabase: Pick<SupabaseClient, 'from'>,
  orderId: string,
  step: OrderCancellationSideEffectStep
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('order_cancellation_side_effects')
      .update({ attempts: 0 })
      .eq('order_id', orderId)
      .eq('step', step);
    return error != null;
  } catch {
    return true;
  }
}
