import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Files an evidence-mismatch review for a stale attempt whose local
 * reference provider verification rejects outright (malformed or overlong),
 * then stamps the row so the sweep never reselects it. Returns true when
 * the row is durably resolved. A conflicting open review (23505) still
 * retries the stamp: without it the attempt would rotate forever, since
 * every later sweep hits the same conflict.
 */
export async function fileInvalidAttemptReference({
  attempt,
  reason,
  supabase,
}: {
  attempt: {
    gateway_reference: string;
    id: string;
    merchant_id: string;
    metadata: Record<string, unknown> | null;
    order_id: string;
  };
  reason: string;
  supabase: SupabaseClient;
}): Promise<boolean> {
  const { error: reviewError } = await supabase
    .from('reconciliation_review')
    .insert({
      issue_type: 'abandoned_attempt_evidence_mismatch',
      order_id: attempt.order_id,
      merchant_id: attempt.merchant_id,
      txn_id: attempt.id,
      paystack_ref: attempt.gateway_reference,
      reason: `Stale Paystack attempt ${attempt.gateway_reference} carries a reference provider verification rejects (${reason}); correct the reference or retire the row`,
      metadata: {
        payment_transaction_id: attempt.id,
        local_reference: attempt.gateway_reference,
        invalid_reference: true,
      },
    });
  if (reviewError && (reviewError as { code?: string }).code !== '23505') {
    return false;
  }
  const { error: stampError } = await supabase
    .from('transactions')
    .update({
      metadata: {
        ...(attempt.metadata ?? {}),
        abandoned_sweep_resolution: 'invalid_reference',
        abandoned_sweep_resolved_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    })
    .eq('id', attempt.id);
  return !stampError;
}
