import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Files an evidence-mismatch review for a stale attempt whose local
 * reference provider verification rejects outright (malformed or overlong),
 * then stamps the row so the sweep never reselects it. A missing (NULL)
 * reference files the same way without ever verifying: there is no
 * reference to check, yet the row still blocks merchant cancellation
 * while pending/processing. Returns true when the row is durably
 * resolved. A conflicting open review (23505) merges this attempt's
 * evidence into the existing order review before stamping: the stamp
 * prevents reselection while the transaction remains pending, so
 * unmerged evidence would strand an unidentified row. When the merge
 * finds no open review for this order, the global ref slot belongs to
 * another order's capture: refile without occupying paystack_ref (like
 * the duplicate-capture filers) so this attempt keeps its own
 * operations review instead of colliding forever. Missing-reference
 * rows never occupy the ref slot in the first place.
 */
export async function fileInvalidAttemptReference({
  attempt,
  reason,
  supabase,
}: {
  attempt: {
    gateway_reference: string | null;
    id: string;
    merchant_id: string;
    metadata: Record<string, unknown> | null;
    order_id: string;
  };
  reason: string;
  supabase: SupabaseClient;
}): Promise<boolean> {
  const missingReference = attempt.gateway_reference == null;
  const row = {
    issue_type: 'abandoned_attempt_evidence_mismatch',
    order_id: attempt.order_id,
    merchant_id: attempt.merchant_id,
    txn_id: attempt.id,
    paystack_ref: attempt.gateway_reference,
    reason: missingReference
      ? `Stale Paystack attempt ${attempt.id} carries no gateway reference and can never verify (${reason}); correct the reference or retire the row so merchant cancellation stops rejecting the order`
      : `Stale Paystack attempt ${attempt.gateway_reference} carries a reference provider verification rejects (${reason}); correct the reference or retire the row`,
    metadata: {
      payment_transaction_id: attempt.id,
      local_reference: attempt.gateway_reference,
      invalid_reference: true,
      ...(missingReference ? { missing_reference: true } : {}),
    },
  };
  const { error: reviewError } = await supabase
    .from('reconciliation_review')
    .insert(row);
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
        p_reason: missingReference
          ? `missing reference, never verifiable (${reason})`
          : `invalid reference rejected by verification (${reason})`,
      }
    );
    if (mergeError) return false;
    if (merged !== true) {
      // No open review for this order: the ref slot is owned by
      // another order's capture. File without occupying paystack_ref
      // so this attempt keeps its own operations review instead of
      // colliding forever; the column stays truthful — this review
      // never claims the reference — while metadata keeps the full
      // gateway evidence.
      const { error: nullRefError } = await supabase
        .from('reconciliation_review')
        .insert({ ...row, paystack_ref: null });
      if (nullRefError) return false;
    }
  }
  const { data: stamped, error: stampError } = await supabase.rpc(
    'stamp_abandoned_sweep_resolution_v1',
    {
      p_transaction_id: attempt.id,
      p_expected_reference: attempt.gateway_reference,
      p_resolution: missingReference
        ? 'missing_reference'
        : 'invalid_reference',
    }
  );
  return !stampError && stamped === true;
}
