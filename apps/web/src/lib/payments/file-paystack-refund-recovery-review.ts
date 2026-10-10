import type { SupabaseClient } from '@supabase/supabase-js';

export interface PaystackRefundRecoveryReview {
  candidates: Record<string, unknown>[];
  merchantId: string;
  metadata: Record<string, unknown>;
  orderId: string;
  paystackRef: string | null;
  providerRefundStatus: string;
  reason: string;
}

// Per-refund entries reuse the nested shape the completion RPC resolves, so
// every merged refund must complete before the review closes. The verified
// verdict rides along per entry: a definitively failed provider refund
// moved no money, so audit blocking excludes failed-only evidence per leg
// instead of stranding a later genuine cancellation behind
// delivery_uncertain. Candidate leg ids travel with the entry because the
// top-level transaction id is often unset for candidate reviews.
function nestedEvidence(review: PaystackRefundRecoveryReview) {
  const candidateLegIds = review.candidates
    .map((candidate) => candidate.payment_transaction_id)
    .filter((id): id is string => typeof id === 'string');
  return {
    [`provider:${String(review.metadata.provider_refund_id)}`]: {
      audit_record_failed: true,
      payment_transaction_id: review.metadata.payment_transaction_id ?? null,
      provider_refund_status: review.providerRefundStatus,
      candidate_payment_transaction_ids: candidateLegIds,
      reason: review.reason.slice(0, 120),
      observed_at: new Date().toISOString(),
    },
  };
}

/**
 * File a recovery review when no local refund row exists to attach it to.
 * A single RPC inserts the review or atomically merges into the open one,
 * so concurrent webhooks cannot clobber each other's provider evidence.
 * Never throws for duplicate filings: re-merging the same evidence is
 * idempotent (provider-keyed evidence, transaction-deduped candidates).
 */
export async function filePaystackRefundRecoveryReview(
  supabase: SupabaseClient,
  review: PaystackRefundRecoveryReview
): Promise<void> {
  const { data, error } = await supabase.rpc(
    'file_paystack_refund_recovery_review_v1',
    {
      p_candidates: review.candidates,
      p_merchant_id: review.merchantId,
      p_metadata: {
        ...review.metadata,
        refund_evidence: nestedEvidence(review),
      },
      p_order_id: review.orderId,
      p_paystack_ref: review.paystackRef,
      p_reason: review.reason,
    }
  );
  if (error || !data) {
    throw new Error('refund_recovery_review_failed');
  }
}
