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

  // Legacy refunds carry no payment link. Mirror the completion RPC's
  // sole-external-payment rule: when the order's single completed
  // external payment is a Paystack leg covered by unlinked completed
  // refunds, the payment is already reconciled. Filing here would leave
  // a permanent false review — without a provider refund ID no closer
  // could ever resolve it.
  const { data: externalPayments, error: paymentsError } = await supabase
    .from('transactions')
    .select('amount, gateway')
    .eq('order_id', orderId)
    .eq('merchant_id', merchantId)
    .eq('transaction_type', 'payment')
    .eq('status', 'completed')
    .gt('amount', 0)
    .not(
      'gateway',
      'in',
      '(wallet,savings,store_credit,cash,manual,pay_on_delivery)'
    );
  if (paymentsError) throw new Error('refund_event_lookup_failed');
  if ((externalPayments ?? []).length === 1) {
    const sole = (
      externalPayments as Array<{ amount: number | string; gateway: string }>
    )[0] as { amount: number | string; gateway: string };
    if (sole.gateway === 'paystack') {
      const { data: legacyRefunds, error: legacyError } = await supabase
        .from('transactions')
        .select('amount')
        .eq('order_id', orderId)
        .eq('merchant_id', merchantId)
        .eq('transaction_type', 'refund')
        .eq('gateway', 'paystack')
        .eq('status', 'completed')
        .is('metadata->>payment_transaction_id', null);
      if (legacyError) throw new Error('refund_event_lookup_failed');
      const covered = (
        (legacyRefunds ?? []) as Array<{ amount: number | string }>
      ).reduce((total, row) => total + (Number(row.amount) || 0), 0);
      if (covered >= Number(sole.amount)) return;
    }
  }

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
    // The order already has an open review: merge this leg as ambiguous.
    // A non-ambiguous merge would let a later replacement refund
    // auto-close the review even though this event may represent an
    // additional provider refund with no local row or provider ID.
    const { data: merged, error: mergeError } = await supabase.rpc(
      'merge_paystack_cancellation_refund_leg_evidence_v1',
      {
        p_order_id: orderId,
        p_merchant_id: merchantId,
        p_payment_transaction_id: paymentId,
        p_reason: reason,
        p_accepted_refund_ids: null,
        p_candidates: candidates,
        p_ambiguous: true,
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
