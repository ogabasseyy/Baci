import type { SupabaseClient } from '@supabase/supabase-js';
import type { DuplicateCaptureEvidence } from './file-duplicate-payment-capture';

/**
 * Fallback duplicate-capture filing for post-completion failures. The
 * primary filer already flipped the attempt row to completed, so the
 * status-guarded sweep hold persists nothing and no sweep reselects
 * the row — without this direct insert the captured extra payment
 * permanently loses its operations review. Mirrors the primary filer's
 * row so the fallback review is indistinguishable in the ops queue.
 * Returns true when the evidence is durable. No stamp attempt: the
 * stamp only excludes rows from sweeps, which already exclude
 * completed rows.
 */
export async function fileDuplicateCaptureFallbackReview({
  attempt,
  evidence,
  supabase,
}: {
  attempt: {
    gateway_reference: string;
    id: string;
    merchant_id: string;
    order_id: string;
  };
  evidence: DuplicateCaptureEvidence;
  supabase: SupabaseClient;
}): Promise<boolean> {
  // The primary insert may have succeeded while the merge or stamp
  // failed: our own open review already makes the evidence durable.
  const { data: existing, error: lookupError } = await supabase
    .from('reconciliation_review')
    .select('id')
    .eq('issue_type', 'duplicate_payment_capture_requires_review')
    .eq('txn_id', attempt.id)
    .is('resolved_at', null)
    .maybeSingle();
  if (!lookupError && existing) return true;
  const detail = evidence.mismatchKind
    ? ` with ${evidence.mismatchKind} (${evidence.mismatchDetail ?? 'provider evidence differs'})`
    : '';
  const row = {
    issue_type: 'duplicate_payment_capture_requires_review',
    order_id: attempt.order_id,
    merchant_id: attempt.merchant_id,
    txn_id: attempt.id,
    paystack_ref:
      evidence.gateway === 'paystack' ? attempt.gateway_reference : null,
    reason: `Stale ${evidence.gateway} attempt ${attempt.gateway_reference} verified as captured while the order is already paid; possible duplicate charge${detail}`,
    metadata: {
      gateway: evidence.gateway,
      payment_transaction_id: attempt.id,
      gateway_reference: attempt.gateway_reference,
      provider_reference: evidence.providerReference,
      provider_status: evidence.providerStatus,
      provider_amount: evidence.providerAmount,
      provider_currency: evidence.providerCurrency,
      ...(evidence.mismatchKind
        ? { evidence_mismatch: evidence.mismatchKind }
        : {}),
    },
  };
  const { error } = await supabase.from('reconciliation_review').insert(row);
  if (!error) return true;
  if ((error as { code?: string }).code !== '23505') return false;
  // The ref slot is owned by another order's capture: file without
  // occupying paystack_ref so this capture keeps its own operations
  // review instead of colliding forever. The column stays truthful —
  // this review never claims the reference — while metadata keeps the
  // full gateway evidence.
  const { error: nullRefError } = await supabase
    .from('reconciliation_review')
    .insert({ ...row, paystack_ref: null });
  return !nullRefError;
}
