import type { SupabaseClient } from '@supabase/supabase-js';

export interface TerminalAttemptMismatchEvidence {
  mismatchDetail: string;
  mismatchKind: string;
  providerAmount: number;
  providerCurrency: string;
  providerReference: string;
  providerStatus: string;
}

/**
 * Files an evidence-mismatch review for a stale attempt Paystack reports as
 * terminal (abandoned/failed/reversed) with evidence that does not match
 * the local row, then stamps the row so the sweep never reselects it. Returns true
 * when the row is durably resolved. A conflicting open review (23505)
 * merges this attempt's evidence into the existing order review before
 * stamping: the stamp prevents reselection while the transaction remains
 * pending, so unmerged evidence would strand an unidentified row.
 */
export async function fileTerminalAttemptEvidenceMismatch({
  attempt,
  evidence,
  supabase,
}: {
  attempt: {
    amount: number;
    currency: string;
    gateway_reference: string;
    id: string;
    merchant_id: string;
    metadata: Record<string, unknown> | null;
    order_id: string;
  };
  evidence: TerminalAttemptMismatchEvidence;
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
      reason: `Stale Paystack attempt ${attempt.gateway_reference} is terminal (${evidence.providerStatus}) but its provider evidence does not match the local row (${evidence.mismatchKind}: ${evidence.mismatchDetail})`,
      metadata: {
        payment_transaction_id: attempt.id,
        provider_status: evidence.providerStatus,
        provider_reference: evidence.providerReference,
        provider_amount: evidence.providerAmount,
        provider_currency: evidence.providerCurrency,
        local_amount: attempt.amount,
        local_currency: attempt.currency,
        local_reference: attempt.gateway_reference,
        evidence_mismatch: evidence.mismatchKind,
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
        p_reason: `terminal ${evidence.providerStatus} ${evidence.mismatchKind} (${evidence.mismatchDetail})`,
      }
    );
    if (mergeError || merged !== true) return false;
  }
  const { data: stamped, error: stampError } = await supabase.rpc(
    'stamp_abandoned_sweep_resolution_v1',
    {
      p_transaction_id: attempt.id,
      p_expected_reference: attempt.gateway_reference,
      p_resolution: 'terminal_evidence_mismatch',
    }
  );
  return !stampError && stamped === true;
}
