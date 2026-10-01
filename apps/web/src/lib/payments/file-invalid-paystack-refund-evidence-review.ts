import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';

/**
 * File a generic review for a signed Paystack refund whose provider
 * evidence is unusable and matches no local payment. The order-scoped
 * filers need candidate orders, so without this row the wedge branch
 * would throw for redelivery with no durable trace — and when
 * provider retries stop, the malformed evidence would vanish while
 * the customer may have been refunded. One open review per
 * reference: redeliveries merge refund-keyed evidence into it.
 * Throws on write failure for redelivery.
 */
export async function fileInvalidPaystackRefundEvidenceReview(
  supabase: SupabaseClient,
  {
    evidence,
    reason,
    reference,
    refundId,
  }: {
    evidence: {
      providerPaymentTransactionId: unknown;
      providerRefundId: number;
      providerRefundStatus: string;
      reference: string;
    };
    reason: string;
    reference: string;
    refundId: number;
  }
): Promise<void> {
  const evidenceKey = `refund:${refundId}`;
  const entry = {
    ...evidence,
    reason: reason.slice(0, 120),
    observed_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('reconciliation_review').insert({
    candidates: [],
    issue_type: 'paystack_refund_evidence_invalid',
    merchant_id: null,
    metadata: {
      provider_refund_id: refundId,
      reference,
      refund_evidence: {
        [evidenceKey]: entry,
      },
    },
    order_id: null,
    // The generic review has no order or payment to dedup on, so the
    // reference keys it: the open-by-paystack-ref index collapses
    // redeliveries into the merge path below.
    paystack_ref: reference,
    reason,
    txn_id: null,
  });
  if (!error) {
    logger.warn({
      message:
        'Paystack refund returned unusable provider evidence with no local payment match',
      refundId,
      reference,
    });
    return;
  }
  if ((error as { code?: string }).code !== '23505') {
    throw new Error('invalid_refund_evidence_review_persistence_failed');
  }
  const { data: merged, error: mergeError } = await supabase.rpc(
    'merge_paystack_refund_evidence_invalid_v1',
    {
      p_paystack_ref: reference,
      p_evidence_key: evidenceKey,
      p_evidence: entry,
    }
  );
  if (mergeError || merged !== true) {
    throw new Error('invalid_refund_evidence_review_persistence_failed');
  }
}
