import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Resolve the reference watch once the event's evidence is durably
 * handled (per-payment reviews filed). A leaked open watch would let
 * a later unrelated completion claim it and file stale evidence, so
 * failures throw for redelivery instead of warning and continuing —
 * the reference-only path is idempotent under redelivery.
 */
export async function resolvePaystackRefundReferenceWatch(
  supabase: SupabaseClient,
  { reference }: { reference: string }
): Promise<void> {
  const { error } = await supabase.rpc(
    'resolve_paystack_refund_reference_watch_v1',
    { p_paystack_ref: reference }
  );
  if (error) throw new Error('refund_recovery_watch_resolve_failed');
}
