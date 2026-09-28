import type { SupabaseClient } from '@supabase/supabase-js';
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
  supabase: Pick<SupabaseClient, 'rpc'>;
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
    return status === 'completed' ? 'delivery_uncertain' : status;
  }
  return status;
}
