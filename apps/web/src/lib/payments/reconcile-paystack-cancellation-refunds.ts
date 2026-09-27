import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { verifyTransaction } from '@/lib/paystack';
import { fetchRefund } from './fetch-paystack-refund';

interface RefundRow {
  id: string;
  order_id: string | null;
  merchant_id: string;
  gateway_reference: string | null;
  amount: number;
  currency: string;
  metadata: Record<string, unknown> | null;
  status: string;
}

const DETERMINISTIC_REFUND_ERRORS = new Set([
  'invalid_local_refund_link',
  'refund_payment_link_mismatch',
  'paystack_refund_evidence_mismatch',
  'unknown_paystack_refund_status',
  'refund_transition_evidence_mismatch',
]);

export function isDeterministicRefundError(error: unknown): error is Error {
  return (
    error instanceof Error && DETERMINISTIC_REFUND_ERRORS.has(error.message)
  );
}

export async function fileRefundEvidenceReview(
  supabase: SupabaseClient,
  refund: RefundRow,
  reason: string
): Promise<void> {
  const { error } = await supabase.from('reconciliation_review').insert({
    issue_type: 'order_cancellation_refund_requires_review',
    order_id: refund.order_id,
    merchant_id: refund.merchant_id,
    txn_id: refund.id,
    paystack_ref: refund.gateway_reference,
    reason: `Paystack cancellation refund evidence mismatch: ${reason}`,
    metadata: { refund_transaction_id: refund.id, reason },
  });
  if (error?.code === '23505') {
    const { data: merged, error: mergeError } = await supabase.rpc(
      'merge_paystack_cancellation_refund_review_v1',
      {
        p_order_id: refund.order_id,
        p_merchant_id: refund.merchant_id,
        p_refund_id: refund.id,
        p_reason: reason,
      }
    );
    if (mergeError || merged !== true)
      throw new Error('refund_evidence_review_persistence_failed');
  } else if (error) {
    throw new Error('refund_evidence_review_persistence_failed');
  }
  logger.warn({
    message: 'Paystack cancellation refund requires reconciliation review',
    refundId: refund.id,
    orderId: refund.order_id,
    reason,
  });
}

async function holdRefundForReview(
  supabase: SupabaseClient,
  refundId: string,
  reason: string
): Promise<void> {
  const { data, error } = await supabase.rpc(
    'hold_paystack_cancellation_refund_for_review_v1',
    { p_refund_id: refundId, p_reason: reason }
  );
  if (error || data !== true) throw new Error('refund_review_hold_failed');
}

/** A signed event is only a wake-up hint. Provider reads decide the transition. */
export async function reconcilePaystackCancellationRefund(
  supabase: SupabaseClient,
  refund: RefundRow
): Promise<'updated' | 'unchanged'> {
  const refundId = Number(refund.gateway_reference);
  const paymentId = refund.metadata?.payment_transaction_id;
  if (
    !Number.isSafeInteger(refundId) ||
    refundId <= 0 ||
    typeof paymentId !== 'string' ||
    !refund.order_id
  )
    throw new Error('invalid_local_refund_link');

  const { data: payment, error: paymentError } = await supabase
    .from('transactions')
    .select(
      'id, order_id, merchant_id, gateway_reference, amount, currency, status'
    )
    .eq('id', paymentId)
    .eq('order_id', refund.order_id)
    .eq('merchant_id', refund.merchant_id)
    .eq('transaction_type', 'payment')
    .eq('gateway', 'paystack')
    .eq('status', 'completed')
    .maybeSingle();
  if (
    paymentError ||
    !payment?.gateway_reference ||
    Number(payment.amount) !== Number(refund.amount) ||
    payment.currency.toUpperCase() !== refund.currency.toUpperCase()
  ) {
    throw new Error('refund_payment_link_mismatch');
  }

  const [providerRefund, providerPayment] = await Promise.all([
    fetchRefund(refundId, AbortSignal.timeout(8_000)),
    verifyTransaction(payment.gateway_reference, AbortSignal.timeout(8_000)),
  ]);
  if (!providerRefund.success || !providerPayment.success) {
    throw new Error('paystack_refund_verification_unavailable');
  }
  const current = providerRefund.data;
  const original = providerPayment.data;
  if (
    current.id !== refundId ||
    current.transaction !== original.id ||
    original.reference !== payment.gateway_reference ||
    original.amount !== Math.round(Number(payment.amount) * 100) ||
    current.amount !== Math.round(Number(refund.amount) * 100) ||
    current.currency.toUpperCase() !== refund.currency.toUpperCase() ||
    original.currency.toUpperCase() !== refund.currency.toUpperCase() ||
    (typeof refund.metadata?.provider_payment_transaction_id === 'number' &&
      refund.metadata.provider_payment_transaction_id !== original.id)
  )
    throw new Error('paystack_refund_evidence_mismatch');

  const status = current.status.toLowerCase();
  if (
    ![
      'pending',
      'processing',
      'needs-attention',
      'failed',
      'processed',
    ].includes(status)
  ) {
    throw new Error('unknown_paystack_refund_status');
  }
  const { error } = await supabase.rpc(
    'record_verified_paystack_cancellation_refund_v1',
    {
      p_refund_id: refund.id,
      p_provider_status: status,
      p_provider_transaction_id: original.id,
      p_amount_kobo: current.amount,
      p_currency: current.currency,
    }
  );
  if (error) {
    if (
      [
        'refund_evidence_mismatch',
        'refund_order_mismatch',
        'refund_not_found',
        'invalid_refund_evidence',
      ].includes(error.message)
    )
      throw new Error('refund_transition_evidence_mismatch');
    throw new Error('refund_transition_failed');
  }
  return status === 'processed' ||
    status === 'failed' ||
    status === 'needs-attention'
    ? 'updated'
    : 'unchanged';
}

export async function reconcilePaystackRefundEvent(
  supabase: SupabaseClient,
  transactionReference: string
): Promise<void> {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(transactionReference)) return;
  const { data: payments, error: paymentError } = await supabase
    .from('transactions')
    .select('id, order_id, merchant_id')
    .eq('gateway', 'paystack')
    .eq('gateway_reference', transactionReference)
    .eq('transaction_type', 'payment')
    .eq('status', 'completed')
    .limit(10);
  if (paymentError) throw new Error('refund_event_payment_lookup_failed');
  for (const payment of payments ?? []) {
    if (!payment.order_id) continue;
    const { data: refunds, error } = await supabase
      .from('transactions')
      .select(
        'id, order_id, merchant_id, gateway_reference, amount, currency, metadata, status'
      )
      .eq('order_id', payment.order_id)
      .eq('merchant_id', payment.merchant_id)
      .eq('transaction_type', 'refund')
      .eq('gateway', 'paystack')
      .eq('metadata->>payment_transaction_id', payment.id)
      // A new signed provider event may resolve a held refund. Only polling
      // excludes review holds; the provider read still verifies all evidence.
      .in('status', ['refund_pending', 'pending', 'failed'])
      .limit(10);
    if (error) throw new Error('refund_event_lookup_failed');
    for (const refund of refunds ?? []) {
      try {
        await reconcilePaystackCancellationRefund(
          supabase,
          refund as RefundRow
        );
      } catch (reason) {
        if (!isDeterministicRefundError(reason)) throw reason;
        await fileRefundEvidenceReview(
          supabase,
          refund as RefundRow,
          reason.message
        );
        await holdRefundForReview(supabase, refund.id, reason.message);
      }
    }
  }
}

export async function reconcilePendingPaystackCancellationRefunds(
  supabase: SupabaseClient,
  limit = 25
): Promise<{ checked: number; failed: number }> {
  const { data, error } = await supabase
    .from('transactions')
    .select(
      'id, order_id, merchant_id, gateway_reference, amount, currency, metadata, status'
    )
    .eq('transaction_type', 'refund')
    .eq('gateway', 'paystack')
    .in('status', ['refund_pending', 'pending'])
    .not('metadata->>payment_transaction_id', 'is', null)
    .is('metadata->>refund_reconciliation_hold', null)
    .order('updated_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error('pending_refund_lookup_failed');
  let failed = 0;
  for (const refund of data ?? []) {
    try {
      await reconcilePaystackCancellationRefund(supabase, refund as RefundRow);
    } catch (reason) {
      failed++;
      logger.warn({
        message: 'Paystack cancellation refund check requires another attempt',
        refundId: refund.id,
        orderId: refund.order_id,
        reason: reason instanceof Error ? reason.message : 'unknown',
      });
      // Rotate an unavailable or mismatched provider row so it cannot starve
      // every newer pending refund in this bounded cron batch.
      const { error: rotationError } = await supabase
        .from('transactions')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', refund.id)
        .in('status', ['refund_pending', 'pending']);
      if (rotationError) throw new Error('pending_refund_rotation_failed');
      if (isDeterministicRefundError(reason)) {
        await fileRefundEvidenceReview(
          supabase,
          refund as RefundRow,
          reason.message
        );
        await holdRefundForReview(supabase, refund.id, reason.message);
      }
    }
  }
  return { checked: data?.length ?? 0, failed };
}
