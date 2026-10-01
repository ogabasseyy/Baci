import type { SupabaseClient } from '@supabase/supabase-js';
import type { GatewayPaymentTransaction } from '@/lib/orders/gateway-payment-transaction';

/**
 * Find payment legs carrying unresolved audit-failed refund evidence. A
 * signed reference-only refund event files such a review when no local
 * refund row exists; the provider refund may already be real, so these
 * legs wait for operations instead of initiating a second full provider
 * refund. Matches by the review's transaction id, its metadata leg id,
 * or merged candidate evidence in either stored case. Fails closed when
 * the lookup errors.
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
    .select('candidates, metadata, txn_id')
    .eq('issue_type', 'order_cancellation_refund_requires_review')
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
    } | null;
    if (metadata?.audit_record_failed !== true) continue;
    const reviewLegIds = new Set<string>();
    if (typeof review.txn_id === 'string') {
      reviewLegIds.add(review.txn_id);
    }
    if (typeof metadata.payment_transaction_id === 'string') {
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
    for (const leg of transactions) {
      if (reviewLegIds.has(leg.id)) auditBlockedLegIds.add(leg.id);
    }
  }
  return auditBlockedLegIds;
}
