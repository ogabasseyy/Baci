import type { SupabaseClient } from '@supabase/supabase-js';
import { clearDuplicateCaptureReviewPending } from './duplicate-capture-review-pending';
import type { DuplicateCaptureEvidence } from './file-duplicate-payment-capture';

/**
 * Fallback duplicate-capture filing for post-completion failures. The
 * primary filer already flipped the attempt row to completed, so the
 * status-guarded sweep hold persists nothing and the main sweep
 * queries reselect nothing — without this direct insert the captured
 * extra payment keeps only its retry-marker rescan for an operations
 * review. Mirrors the primary filer's row so the fallback review is
 * indistinguishable in the ops queue. Returns true when the evidence
 * is durable. No stamp attempt: the stamp only excludes rows from
 * sweeps, which already exclude completed rows.
 */
async function tryMergeFallbackCaptureEvidence(
  supabase: SupabaseClient,
  attempt: {
    gateway_reference: string;
    id: string;
    merchant_id: string;
    order_id: string;
  },
  evidence: DuplicateCaptureEvidence,
  detail: string
): Promise<boolean> {
  // Mirror the primary filer's conflict path exactly: same RPC, same
  // params, so the merge accepts what the insert could not.
  for (let i = 0; i < 2; i++) {
    try {
      const { data: merged, error: mergeError } = await supabase.rpc(
        'merge_duplicate_payment_capture_evidence_v1',
        {
          p_order_id: attempt.order_id,
          p_merchant_id: attempt.merchant_id,
          p_transaction_id: attempt.id,
          p_gateway_reference: attempt.gateway_reference,
          p_gateway: evidence.gateway,
          p_charge_id: evidence.providerReference,
          p_reason: `Stale attempt ${attempt.gateway_reference} verified as captured${detail}`,
          p_provider_amount: evidence.providerAmount,
          p_provider_currency: evidence.providerCurrency,
          p_provider_status: evidence.providerStatus,
        }
      );
      // A definitive false means no open review exists for this order
      // (the conflict is the ref slot, not the order slot): retrying
      // the idempotent merge is pointless, so report it and let the
      // caller fall through to the ref-less insert. Only a transport
      // failure retries.
      if (!mergeError) return merged === true;
    } catch {
      // Transport throw: retry once below, then fall through.
    }
  }
  return false;
}
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
  if (!lookupError && existing) {
    await clearDuplicateCaptureReviewPending(supabase, attempt.id);
    return true;
  }
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
  if (!error) {
    await clearDuplicateCaptureReviewPending(supabase, attempt.id);
    return true;
  }
  if ((error as { code?: string }).code !== '23505') return false;
  // The conflict is either this order's open review or another order's
  // ref slot. A second order-level insert would hit the open-by-order
  // index again, so merge into the open same-order review first — the
  // merge never touches paystack_ref, so it lands exactly when the
  // order slot is the conflict.
  if (
    await tryMergeFallbackCaptureEvidence(supabase, attempt, evidence, detail)
  ) {
    await clearDuplicateCaptureReviewPending(supabase, attempt.id);
    return true;
  }
  // No open review for this order: the ref slot is owned by another
  // order's capture. File without occupying paystack_ref so this
  // capture keeps its own operations review instead of colliding
  // forever. The column stays truthful — this review never claims the
  // reference — while metadata keeps the full gateway evidence.
  const { error: nullRefError } = await supabase
    .from('reconciliation_review')
    .insert({ ...row, paystack_ref: null });
  if (nullRefError) return false;
  await clearDuplicateCaptureReviewPending(supabase, attempt.id);
  return true;
}
