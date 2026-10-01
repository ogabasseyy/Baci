import type { SupabaseClient } from '@supabase/supabase-js';
import type { GatewayPaymentTransaction } from '@/lib/orders/gateway-payment-transaction';

/**
 * Whether outside-cancellation evidence indicates money may have moved.
 * Only a definitively rejected provider refund (every nested entry
 * failed) proves otherwise; missing, empty, malformed, or mixed
 * evidence fails closed and keeps blocking the leg.
 */
function outsideEvidenceIndicatesMovement(refundEvidence: unknown): boolean {
  if (!refundEvidence || typeof refundEvidence !== 'object') return true;
  const entries = Object.values(refundEvidence);
  if (entries.length === 0) return true;
  return entries.some((entry) => {
    const status = (entry as { provider_refund_status?: unknown } | null)
      ?.provider_refund_status;
    return (
      typeof status !== 'string' || status.trim().toLowerCase() !== 'failed'
    );
  });
}

/**
 * Find payment legs carrying unresolved provider-refund evidence. A
 * signed reference-only refund event files such a review when no local
 * refund row exists, and a provider-only refund verified while the
 * order was active leaves outside-cancellation evidence behind; the
 * provider refund may already be real, so these legs wait for
 * operations instead of initiating a second full provider refund.
 * Definitively rejected (failed) outside refunds moved no money and
 * never block. Matches by the review's transaction id, its metadata
 * leg id, merged candidate evidence in either stored case, or nested
 * per-refund evidence entries (recovery merges leave the top-level
 * marker untouched). Marked evidence with no leg attribution fails
 * closed on every leg. Fails closed when the lookup errors.
 */
export async function fetchAuditBlockedCancellationLegIds({
  order,
  supabase,
  transactions,
}: {
  order: { id: string; merchant_id: string };
  supabase: Pick<SupabaseClient, 'from' | 'rpc'>;
  transactions: GatewayPaymentTransaction[];
}): Promise<Set<string>> {
  const { data: auditReviewRows, error: auditReviewError } = await supabase
    .from('reconciliation_review')
    .select('candidates, issue_type, metadata, txn_id')
    .in('issue_type', [
      'order_cancellation_refund_requires_review',
      'provider_refund_outside_cancellation',
    ])
    .eq('order_id', order.id)
    .eq('merchant_id', order.merchant_id)
    .is('resolved_at', null);
  if (auditReviewError) {
    throw new Error('Unable to verify refund evidence reviews');
  }
  const auditBlockedLegIds = new Set<string>();
  for (const review of auditReviewRows ?? []) {
    const metadata = review.metadata as {
      audit_record_failed?: unknown;
      payment_transaction_id?: unknown;
      refund_evidence?: unknown;
    } | null;
    // Outside-cancellation reviews are verified provider-refund
    // evidence by type — unless every nested entry is a definitive
    // provider rejection: a failed refund moved no money, so blocking
    // the leg would strand a later genuine cancellation behind
    // delivery_uncertain for a refund Paystack already refused.
    // Cancellation reviews need an audit-failed marker, top-level or
    // nested.
    const typeCarriesEvidence =
      review.issue_type === 'provider_refund_outside_cancellation' &&
      outsideEvidenceIndicatesMovement(metadata?.refund_evidence);
    const nestedLegIds = new Set<string>();
    let nestedEvidenceMarked = false;
    const refundEvidence = metadata?.refund_evidence;
    if (refundEvidence && typeof refundEvidence === 'object') {
      for (const entry of Object.values(refundEvidence)) {
        const evidence = entry as {
          audit_record_failed?: unknown;
          candidate_payment_transaction_ids?: unknown;
          payment_transaction_id?: unknown;
        } | null;
        if (!typeCarriesEvidence && evidence?.audit_record_failed !== true) {
          continue;
        }
        nestedEvidenceMarked = true;
        if (typeof evidence?.payment_transaction_id === 'string') {
          nestedLegIds.add(evidence.payment_transaction_id);
        }
        const extraIds = evidence?.candidate_payment_transaction_ids;
        if (Array.isArray(extraIds)) {
          for (const extraId of extraIds) {
            if (typeof extraId === 'string') nestedLegIds.add(extraId);
          }
        }
      }
    }
    if (
      !typeCarriesEvidence &&
      metadata?.audit_record_failed !== true &&
      !nestedEvidenceMarked
    ) {
      continue;
    }
    const reviewLegIds = new Set<string>();
    if (typeof review.txn_id === 'string') {
      reviewLegIds.add(review.txn_id);
    }
    if (typeof metadata?.payment_transaction_id === 'string') {
      reviewLegIds.add(metadata.payment_transaction_id);
    }
    // Recovery filers store candidates in snake_case while the
    // reference-only filer uses camelCase; accept both stored shapes.
    const candidates = review.candidates as Array<{
      paymentTransactionId?: unknown;
      payment_transaction_id?: unknown;
    }> | null;
    if (Array.isArray(candidates)) {
      for (const candidate of candidates) {
        if (typeof candidate?.paymentTransactionId === 'string') {
          reviewLegIds.add(candidate.paymentTransactionId);
        }
        if (typeof candidate?.payment_transaction_id === 'string') {
          reviewLegIds.add(candidate.payment_transaction_id);
        }
      }
    }
    for (const nestedLegId of nestedLegIds) {
      reviewLegIds.add(nestedLegId);
    }
    if (reviewLegIds.size === 0) {
      // Marked evidence names no leg: fail closed on every leg rather
      // than risk a double refund on an unattributed provider refund.
      for (const leg of transactions) auditBlockedLegIds.add(leg.id);
      continue;
    }
    for (const leg of transactions) {
      if (reviewLegIds.has(leg.id)) auditBlockedLegIds.add(leg.id);
    }
  }
  return auditBlockedLegIds;
}
