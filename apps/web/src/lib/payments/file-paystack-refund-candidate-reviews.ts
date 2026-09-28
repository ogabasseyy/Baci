import type { SupabaseClient } from '@supabase/supabase-js';
import { filePaystackRefundRecoveryReview } from './file-paystack-refund-recovery-review';

export interface RefundRecoveryEvidence {
  providerPaymentTransactionId: number;
  providerRefundId: number;
  reference: string;
}

interface CandidatePayment {
  amount: number;
  gateway_reference: string | null;
  id: string;
  merchant_id: string;
  order_id: string | null;
}

/**
 * Persist one recovery review per candidate order so ops can route a
 * verified provider refund no local audit row covers, then the caller
 * acknowledges. Shared by the ambiguous-match and stalled-payment paths.
 */
export async function filePaystackRefundCandidateReviews(
  supabase: SupabaseClient,
  candidates: CandidatePayment[],
  evidence: RefundRecoveryEvidence,
  reason: string
): Promise<void> {
  const shared = candidates.map((entry) => ({
    payment_transaction_id: entry.id,
    order_id: entry.order_id,
    amount: entry.amount,
    gateway_reference: entry.gateway_reference,
  }));
  for (const candidate of candidates) {
    if (!candidate.order_id) continue;
    await filePaystackRefundRecoveryReview(supabase, {
      candidates: shared,
      merchantId: candidate.merchant_id,
      metadata: {
        provider_refund_id: evidence.providerRefundId,
        provider_payment_transaction_id: evidence.providerPaymentTransactionId,
        reference: evidence.reference,
        audit_record_failed: true,
        recovered_from_provider_event: true,
      },
      orderId: candidate.order_id,
      // Deliberately unset: every candidate review shares this provider
      // refund, and the open-by-paystack-ref index would collapse all but
      // the first order's review.
      paystackRef: null,
      reason,
    });
  }
}
