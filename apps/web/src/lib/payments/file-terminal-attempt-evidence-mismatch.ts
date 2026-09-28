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
 * terminal (abandoned/failed) with evidence that does not match the local
 * row, then stamps the row so the sweep never reselects it. Returns true
 * when the row is durably resolved. A conflicting open review (23505) still
 * retries the stamp: the review already covers this order, but without the
 * stamp a transient stamp failure would rotate the attempt forever, since
 * every later sweep hits the same conflict. Only a failed stamp or a
 * non-conflict insert error returns false.
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
  const { error: stampError } = await supabase
    .from('transactions')
    .update({
      metadata: {
        ...(attempt.metadata ?? {}),
        abandoned_sweep_resolution: 'terminal_evidence_mismatch',
        abandoned_sweep_resolved_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    })
    .eq('id', attempt.id);
  return !stampError;
}
