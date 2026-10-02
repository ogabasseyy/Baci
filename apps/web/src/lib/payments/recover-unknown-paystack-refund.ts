import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { verifyTransaction } from '@/lib/verify-paystack-transaction';
import { fetchRefund } from './fetch-paystack-refund';
import { fileRefundEvidenceReview } from './file-refund-evidence-review';
import { holdPaystackRefundForReview } from './hold-paystack-refund-for-review';
import { isDeterministicRefundError } from './is-deterministic-paystack-refund-error';
import type { RefundRow } from './paystack-cancellation-refund-row';
import { reconcilePaystackCancellationRefund } from './reconcile-paystack-cancellation-refund';

const PROVIDER_READ_TIMEOUT_MS = 8_000;

interface RecoveryPayment {
  amount: number;
  gateway_reference: string | null;
  id: string;
  merchant_id: string;
  order_id: string | null;
}

async function lookupLocalRefundByProviderId(
  supabase: SupabaseClient,
  refundId: number
): Promise<RefundRow | null> {
  const { data, error } = await supabase
    .from('transactions')
    .select(
      'id, order_id, merchant_id, gateway_reference, amount, currency, metadata, status'
    )
    .eq('transaction_type', 'refund')
    .eq('gateway', 'paystack')
    .eq('gateway_reference', String(refundId))
    .maybeSingle();
  if (error) throw new Error('refund_event_lookup_failed');
  return (data as RefundRow | null) ?? null;
}

async function reconcileRecoveredRow(
  supabase: SupabaseClient,
  refund: RefundRow
): Promise<void> {
  try {
    await reconcilePaystackCancellationRefund(supabase, refund);
  } catch (reason) {
    if (!isDeterministicRefundError(reason)) throw reason;
    await fileRefundEvidenceReview(supabase, refund, reason.message);
    await holdPaystackRefundForReview(supabase, refund.id, reason.message);
  }
}

/**
 * Recover a provider refund the signed event references but no local audit
 * row records — e.g. a merchant-created replacement for a failed automatic
 * refund. A signed event is only a wake-up hint: the refund and its payment
 * are re-verified with Paystack, the payment must be the order's single
 * completed leg on a cancelled order, and only then is a local audit row
 * recorded and reconciled through the standard transition. Anything else
 * is acknowledged without touching existing rows; transient provider or
 * database failures throw so the webhook redelivers.
 */
export async function recoverUnknownPaystackRefund(
  supabase: SupabaseClient,
  refundId: number,
  paymentReference: string
): Promise<void> {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(paymentReference)) {
    logger.info({
      message: 'Unknown Paystack refund event has no usable payment reference',
      refundId,
    });
    return;
  }
  const [providerRefund, providerPayment] = await Promise.all([
    fetchRefund(refundId, AbortSignal.timeout(PROVIDER_READ_TIMEOUT_MS)),
    verifyTransaction(
      paymentReference,
      AbortSignal.timeout(PROVIDER_READ_TIMEOUT_MS)
    ),
  ]);
  if (!providerRefund.success || !providerPayment.success) {
    throw new Error('paystack_refund_verification_unavailable');
  }
  const current = providerRefund.data;
  const original = providerPayment.data;
  if (
    current.id !== refundId ||
    current.transaction !== original.id ||
    original.reference !== paymentReference ||
    !Number.isSafeInteger(current.amount) ||
    current.amount <= 0 ||
    typeof current.currency !== 'string' ||
    typeof current.status !== 'string'
  ) {
    logger.info({
      message: 'Unknown Paystack refund event does not match its payment',
      refundId,
    });
    return;
  }
  const { data: payments, error: paymentError } = await supabase
    .from('transactions')
    .select('id, order_id, merchant_id, gateway_reference, amount')
    .eq('gateway', 'paystack')
    .eq('gateway_reference', paymentReference)
    .eq('transaction_type', 'payment')
    .eq('status', 'completed')
    .limit(2);
  if (paymentError) throw new Error('refund_event_payment_lookup_failed');
  const candidates = (payments ?? []) as RecoveryPayment[];
  const payment = candidates[0];
  if (candidates.length !== 1 || !payment || !payment.order_id) {
    logger.info({
      message:
        'Unknown Paystack refund event matches no single completed payment',
      refundId,
    });
    return;
  }
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('id, order_number, cancelled_at, shipping_status')
    .eq('id', payment.order_id)
    .maybeSingle();
  if (orderError) throw new Error('refund_event_order_lookup_failed');
  if (
    !order ||
    order.cancelled_at == null ||
    (order.shipping_status !== 'cancelled' &&
      order.shipping_status !== 'canceled')
  ) {
    logger.info({
      message: 'Unknown Paystack refund event is not for a cancelled order',
      refundId,
    });
    return;
  }
  // A concurrent event (or the in-flight initiation) may record the row
  // first: on conflict, reconcile the winning row instead of failing.
  const refundRowId = crypto.randomUUID();
  const { error: insertError } = await supabase.from('transactions').insert({
    id: refundRowId,
    order_id: payment.order_id,
    merchant_id: payment.merchant_id,
    transaction_type: 'refund',
    amount: current.amount / 100,
    currency: current.currency,
    status: 'refund_pending',
    gateway: 'paystack',
    gateway_reference: String(refundId),
    description: `Refund for cancelled order #${order.order_number || order.id.slice(0, 8)}`,
    metadata: {
      payment_transaction_id: payment.id,
      provider_payment_transaction_id: original.id,
      provider_refund_status: current.status.toLowerCase(),
      recovered_from_provider_event: true,
    },
  });
  if (insertError) {
    if ((insertError as { code?: string }).code === '23505') {
      const raced = await lookupLocalRefundByProviderId(supabase, refundId);
      if (raced) {
        await reconcileRecoveredRow(supabase, raced);
        return;
      }
    }
    throw new Error('refund_recovery_audit_failed');
  }
  await reconcileRecoveredRow(supabase, {
    id: refundRowId,
    order_id: payment.order_id,
    merchant_id: payment.merchant_id,
    gateway_reference: String(refundId),
    amount: current.amount / 100,
    currency: current.currency,
    metadata: {
      payment_transaction_id: payment.id,
      provider_payment_transaction_id: original.id,
      provider_refund_status: current.status.toLowerCase(),
      recovered_from_provider_event: true,
    },
    status: 'refund_pending',
  });
}
