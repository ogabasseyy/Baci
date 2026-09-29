import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Files an evidence-mismatch review for a stale attempt whose local
 * reference provider verification rejects outright (malformed or overlong),
 * then stamps the row so the sweep never reselects it. Returns true when
 * the row is durably resolved. A conflicting open review (23505) merges
 * this attempt's evidence into the existing order review before stamping:
 * the stamp prevents reselection while the transaction remains pending, so
 * unmerged evidence would strand an unidentified row.
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
  if (reviewError) {
    const { data: merged, error: mergeError } = await supabase.rpc(
      'merge_abandoned_attempt_evidence_mismatch_v1',
      {
        p_order_id: attempt.order_id,
        p_merchant_id: attempt.merchant_id,
        p_transaction_id: attempt.id,
        p_gateway_reference: attempt.gateway_reference,
        p_reason: `invalid reference rejected by verification (${reason})`,
      }
    );
    if (mergeError || merged !== true) return false;
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
