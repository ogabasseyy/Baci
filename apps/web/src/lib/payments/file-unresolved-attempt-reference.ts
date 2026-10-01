import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Files an evidence-mismatch review for a stale attempt Paystack cannot
 * find (non-DVA HTTP_404). Unlike definitively rejected references the
 * row is NOT stamped: a spurious 404 must not exclude a possibly funded
 * payment from future sweeps, so the caller keeps rotating it. The
 * insert is idempotent — a conflicting open review (23505) merges this
 * attempt's evidence into the existing order review — so every sweep
 * can retry the filing until it lands. Returns true when the evidence
 * is durable.
 */
export async function fileUnresolvedAttemptReference({
  attempt,
  reason,
  supabase,
}: {
  attempt: {
    gateway_reference: string;
    id: string;
    merchant_id: string;
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
      reason: `Stale Paystack attempt ${attempt.gateway_reference} cannot be verified (Paystack returned ${reason}); the sweep keeps rotating it — correct the reference or retire the row`,
      metadata: {
        payment_transaction_id: attempt.id,
        local_reference: attempt.gateway_reference,
        unresolved_reference: true,
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
        p_reason: `unresolved reference (${reason})`,
      }
    );
    if (mergeError || merged !== true) return false;
  }
  return true;
}
