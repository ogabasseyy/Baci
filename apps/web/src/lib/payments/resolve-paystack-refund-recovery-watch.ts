import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Resolve the recovery watch once the refund is durably handled
 * (audit row recorded or candidate evidence filed). A leaked open
 * watch would let a later unrelated completion claim it and file a
 * stale review against an already-reconciled refund, so failures
 * throw for redelivery instead of warning and continuing — every
 * recovery path that resolves is idempotent under redelivery.
 */
export async function resolvePaystackRefundRecoveryWatch(
  supabase: SupabaseClient,
  {
    providerRefundId,
    reference,
  }: {
    providerRefundId: number;
    reference: string;
  }
): Promise<void> {
  const { error } = await supabase.rpc(
    'resolve_paystack_refund_recovery_watch_v1',
    {
      p_paystack_ref: reference,
      p_provider_refund_id: providerRefundId,
    }
  );
  if (error) throw new Error('refund_recovery_watch_resolve_failed');
}
