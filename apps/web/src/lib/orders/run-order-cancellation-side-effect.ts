import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import type { Json } from '@/types/supabase';

export type OrderCancellationSideEffectStep = 'refund' | 'customer_email';
export type OrderCancellationSideEffectStatus =
  | 'completed'
  | 'deferred'
  | 'failed'
  | 'delivery_uncertain';

interface ClaimResult {
  current_status: string;
  we_won: boolean;
}

export class DeliveryUncertainError extends Error {}

// Thrown when the step cannot advance until provider reconciliation moves
// (e.g. a refund leg is still pending at Paystack). Unlike a failure this
// consumes no retry attempt: the drain reselects deferred rows until the
// provider state advances.
export class DeferredError extends Error {}

export async function runOrderCancellationSideEffect({
  execute,
  orderId,
  step,
  supabase,
}: {
  execute: () => Promise<Json | undefined>;
  orderId: string;
  step: OrderCancellationSideEffectStep;
  supabase: Pick<SupabaseClient, 'from' | 'rpc'>;
}): Promise<OrderCancellationSideEffectStatus> {
  const claimToken = crypto.randomUUID();
  const { data: claim, error: claimError } = await supabase
    .rpc('claim_order_cancellation_side_effect', {
      p_claim_token: claimToken,
      p_order_id: orderId,
      p_step: step,
    })
    .single<ClaimResult>();

  if (claimError || !claim) return 'failed';
  if (!claim.we_won) {
    return claim.current_status === 'completed'
      ? 'completed'
      : claim.current_status === 'delivery_uncertain'
        ? 'delivery_uncertain'
        : 'deferred';
  }

  let result: Json | undefined;
  let status: 'completed' | 'failed' | 'delivery_uncertain' | 'deferred' =
    'completed';
  let errorMessage: string | null = null;
  try {
    result = await execute();
  } catch (error) {
    status =
      error instanceof DeliveryUncertainError
        ? 'delivery_uncertain'
        : error instanceof DeferredError
          ? 'deferred'
          : 'failed';
    errorMessage = error instanceof Error ? error.message : String(error);
  }

  const { data: finished, error: finishError } = await supabase.rpc(
    'finish_order_cancellation_side_effect',
    {
      p_claim_token: claimToken,
      p_error: errorMessage,
      p_order_id: orderId,
      p_result: result ?? null,
      p_status: status,
      p_step: step,
    }
  );

  if (finishError || finished !== true) {
    const restored = status === 'completed' ? 'delivery_uncertain' : status;
    // The finish write may not have landed: the row could still be
    // 'claimed' under our token, which no drain reselects until a
    // stale-claim sweep terminalizes it — stranding e.g. an
    // uninitiated refund leg behind a settled one. Restore the
    // intended reclaimable state, but only while the row is still our
    // claim: a landed write or a concurrent terminalization must never
    // be clobbered. Attempts were already accounted at claim time.
    const { error: restoreError } = await supabase
      .from('order_cancellation_side_effects')
      .update({
        error:
          restored === 'delivery_uncertain' && status === 'completed'
            ? 'Completion outcome could not be persisted; delivery requires reconciliation'
            : errorMessage,
        result: result ?? null,
        status: restored,
      })
      .eq('order_id', orderId)
      .eq('step', step)
      .eq('status', 'claimed')
      .eq('claim_token', claimToken);
    if (restoreError) {
      logger.error({
        error: restoreError,
        message:
          'Cancellation side-effect claim could not be restored after a failed finish write',
        orderId,
        step,
      });
    }
    return restored;
  }
  return status;
}
