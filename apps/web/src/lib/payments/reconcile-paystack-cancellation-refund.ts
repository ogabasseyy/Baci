import type { SupabaseClient } from '@supabase/supabase-js';
import { verifyTransaction } from '@/lib/verify-paystack-transaction';
import { fetchRefund } from './fetch-paystack-refund';
import type { RefundRow } from './paystack-cancellation-refund-row';

/** A signed event is only a wake-up hint. Provider reads decide the transition. */
const EXTERNAL_PAYMENT_GATEWAYS_EXCLUSION = new Set([
  'wallet',
  'savings',
  'store_credit',
  'cash',
  'manual',
  'pay_on_delivery',
]);

async function resolveLinkedPayment(
  supabase: SupabaseClient,
  refund: RefundRow,
  paymentId: string
) {
  const { data: payment, error } = await supabase
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
  if (error) throw new Error('refund_payment_link_mismatch');
  return payment;
}

async function resolveSoleLegacyPayment(
  supabase: SupabaseClient,
  refund: RefundRow
) {
  // Legacy refunds carry no payment_transaction_id. Mirror the cancellation
  // claim rule: the refund belongs to the order's sole completed external
  // payment when exactly one exists.
  const { data, error } = await supabase
    .from('transactions')
    .select('id, gateway, gateway_reference, amount, currency')
    .eq('order_id', refund.order_id)
    .eq('merchant_id', refund.merchant_id)
    .eq('transaction_type', 'payment')
    .eq('status', 'completed')
    .gt('amount', 0);
  if (error) throw new Error('refund_payment_link_mismatch');
  const candidates = (data ?? []).filter(
    (payment) =>
      !EXTERNAL_PAYMENT_GATEWAYS_EXCLUSION.has(
        String(payment.gateway ?? '').toLowerCase()
      )
  );
  if (candidates.length !== 1) throw new Error('refund_payment_link_mismatch');
  const [sole] = candidates;
  if (sole?.gateway !== 'paystack')
    throw new Error('refund_payment_link_mismatch');
  return sole;
}

export async function reconcilePaystackCancellationRefund(
  supabase: SupabaseClient,
  refund: RefundRow
): Promise<'updated' | 'unchanged'> {
  const refundId = Number(refund.gateway_reference);
  const paymentId = refund.metadata?.payment_transaction_id;
  if (
    !Number.isSafeInteger(refundId) ||
    refundId <= 0 ||
    !refund.order_id ||
    (typeof paymentId !== 'string' &&
      paymentId !== undefined &&
      paymentId !== null)
  )
    throw new Error('invalid_local_refund_link');

  const payment =
    typeof paymentId === 'string'
      ? await resolveLinkedPayment(supabase, refund, paymentId)
      : await resolveSoleLegacyPayment(supabase, refund);
  if (
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
