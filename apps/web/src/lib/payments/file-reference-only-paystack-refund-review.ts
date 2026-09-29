import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';

/**
 * File a durable review for a signed reference-only refund event with no
 * local audit row (provider-side manual refund, lost audit insert). A
 * completed linked row means the event is a late duplicate and stays
 * silent; otherwise polling can never rediscover the provider refund, so
 * the review stays open for operations instead of acknowledging silently.
 * Redeliveries merge into the open review instead of duplicating it.
 */
export async function fileReferenceOnlyPaystackRefundReview(
  supabase: SupabaseClient,
  {
    amount,
    currency,
    merchantId,
    orderId,
    paymentId,
    paymentReference,
  }: {
    amount: number;
    currency: string;
    merchantId: string;
    orderId: string;
    paymentId: string;
    paymentReference: string;
  }
): Promise<void> {
  const { data: settled, error: settledError } = await supabase
    .from('transactions')
    .select('id')
    .eq('order_id', orderId)
    .eq('merchant_id', merchantId)
    .eq('transaction_type', 'refund')
    .eq('gateway', 'paystack')
    .eq('metadata->>payment_transaction_id', paymentId)
    .eq('status', 'completed')
    .limit(1);
  if (settledError) throw new Error('refund_event_lookup_failed');
  if ((settled ?? []).length > 0) return;

  const reason =
    `Paystack refund event for payment ${paymentReference} has no local ` +
    'audit row; verify the provider refund before another is initiated';
  const candidates = [
    {
      amount,
      currency,
      gateway: 'paystack',
      gatewayReference: paymentReference,
      paymentTransactionId: paymentId,
    },
  ];
  const { error } = await supabase.from('reconciliation_review').insert({
    candidates,
    issue_type: 'order_cancellation_refund_requires_review',
    merchant_id: merchantId,
    // No provider refund ID is known (reference-only event), so the
    // audit-failed marker without an ID keeps this open until operations
    // links the provider refund or confirms none exists: auto-closing on
    // other legs' evidence would hide an unreconciled customer refund.
    metadata: {
      audit_record_failed: true,
      payment_transaction_id: paymentId,
      reference: paymentReference,
      reference_only_refund_event: true,
    },
    order_id: orderId,
    paystack_ref: paymentReference,
    reason,
    txn_id: paymentId,
  });
  if (error?.code === '23505') {
    const { data: merged, error: mergeError } = await supabase.rpc(
      'merge_paystack_cancellation_refund_leg_evidence_v1',
      {
        p_order_id: orderId,
        p_merchant_id: merchantId,
        p_payment_transaction_id: paymentId,
        p_reason: reason,
        p_accepted_refund_ids: null,
        p_candidates: candidates,
        p_ambiguous: false,
      }
    );
    if (mergeError || merged !== true) {
      throw new Error('reference_only_refund_review_persistence_failed');
    }
    return;
  }
  if (error) {
    throw new Error('reference_only_refund_review_persistence_failed');
  }
  logger.warn({
    message: 'Paystack reference-only refund event has no local audit row',
    orderId,
    paymentId,
    paymentReference,
  });
}
