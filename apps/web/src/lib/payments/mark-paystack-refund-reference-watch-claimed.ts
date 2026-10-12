import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Retain the reference watch for future matching completions once the
 * event's current matches are durably handled. Claimed is sweep-silent
 * (the sweep selects open rows only, and the retire RPC refuses any
 * watch whose reference has a completed payment) yet stays visible to
 * the completion claim, which files per-payment evidence
 * idempotently. Resolving instead would leave a later payment
 * sharing the reference with no watch to file its refund evidence.
 * Failures throw for redelivery instead of warning and continuing.
 */
export async function markPaystackRefundReferenceWatchClaimed(
  supabase: SupabaseClient,
  { reference }: { reference: string }
): Promise<void> {
  const { error } = await supabase.rpc(
    'mark_paystack_refund_reference_watch_claimed_v1',
    { p_paystack_ref: reference }
  );
  if (error) throw new Error('refund_recovery_watch_claim_failed');
}
