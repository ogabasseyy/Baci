import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';

/**
 * File a generic review for a signed reference-only refund event whose
 * completed payment is detached from any order (the order FK's ON
 * DELETE SET NULL fired, or the order was deleted before the payment
 * completed). The order-scoped filers need candidate orders, so
 * without this row the rescan match would be discarded while the
 * caller resolves the watch — permanently losing the only durable
 * trace of the provider refund. Mirrors the ID-based detached filing
 * into the same order-independent queue, keyed by payment instead of
 * refund ID since a reference-only event carries none. Throws on
 * write failure for redelivery.
 */
export async function fileDetachedReferenceOnlyPaystackRefundReview(
  supabase: SupabaseClient,
  {
    paymentId,
    paymentReference,
    providerRefundStatus,
  }: {
    paymentId: string;
    paymentReference: string;
    providerRefundStatus: string;
  }
): Promise<void> {
  const reason =
    `Paystack refund event for payment ${paymentReference} matched a ` +
    'completed payment detached from any order; route the provider refund manually';
  const evidenceKey = `payment:${paymentId}`;
  const entry = {
    payment_transaction_id: paymentId,
    provider_refund_status: providerRefundStatus,
    reason: reason.slice(0, 120),
    observed_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('reconciliation_review').insert({
    candidates: [],
    issue_type: 'paystack_refund_evidence_invalid',
    merchant_id: null,
    metadata: {
      payment_transaction_id: paymentId,
      reference: paymentReference,
      reference_only_refund_event: true,
      refund_evidence: {
        [evidenceKey]: entry,
      },
    },
    order_id: null,
    // The generic review has no order to dedup on, so the reference
    // keys it: the open-by-paystack-ref index collapses redeliveries
    // into the merge path below.
    paystack_ref: paymentReference,
    reason,
    txn_id: null,
  });
  if (!error) {
    logger.warn({
      message:
        'Paystack reference-only refund event matched a detached payment',
      paymentId,
      paymentReference,
    });
    return;
  }
  if ((error as { code?: string }).code !== '23505') {
    throw new Error('detached_reference_refund_review_persistence_failed');
  }
  const { data: merged, error: mergeError } = await supabase.rpc(
    'merge_paystack_refund_evidence_invalid_v1',
    {
      p_paystack_ref: paymentReference,
      p_evidence_key: evidenceKey,
      p_evidence: entry,
    }
  );
  if (mergeError || merged !== true) {
    throw new Error('detached_reference_refund_review_persistence_failed');
  }
}
