import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { verifyTransaction } from '@/lib/verify-paystack-transaction';
import { fetchPaystackPaymentById } from './fetch-paystack-payment-by-id';
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

// File a recovery review when no local refund row exists to attach it to.
// Redeliveries and concurrent events converge on the single open review per
// order instead of refiling: the open-by-order unique index turns a lost
// race into a no-op, so deterministic conditions never become retry storms.
async function fileRecoveryReviewOnce(
  supabase: SupabaseClient,
  review: {
    candidates: Record<string, unknown>[];
    merchantId: string;
    metadata: Record<string, unknown>;
    orderId: string;
    paystackRef: string | null;
    reason: string;
  }
): Promise<void> {
  const { data: open, error: openError } = await supabase
    .from('reconciliation_review')
    .select('id')
    .eq('issue_type', 'order_cancellation_refund_requires_review')
    .eq('order_id', review.orderId)
    .is('resolved_at', null)
    .limit(1);
  if (openError) throw new Error('refund_recovery_review_failed');
  if (open && (open as unknown[]).length > 0) return;
  const { error: insertError } = await supabase
    .from('reconciliation_review')
    .insert({
      issue_type: 'order_cancellation_refund_requires_review',
      order_id: review.orderId,
      merchant_id: review.merchantId,
      paystack_ref: review.paystackRef,
      reason: review.reason,
      candidates: review.candidates,
      metadata: review.metadata,
    });
  if (insertError && (insertError as { code?: string }).code !== '23505') {
    throw new Error('refund_recovery_review_failed');
  }
}

/**
 * Recover a provider refund the signed event references but no local audit
 * row records — e.g. a merchant-created replacement for a failed automatic
 * refund. A signed event is only a wake-up hint: the refund and its payment
 * are re-verified with Paystack, the payment must be the order's single
 * completed leg on a cancelled order, and only then is a local audit row
 * recorded and reconciled through the standard transition. Events that
 * cannot be verified throw so Paystack can redeliver; unrelated verified
 * payments are acknowledged without touching existing rows.
 */
export async function recoverUnknownPaystackRefund(
  supabase: SupabaseClient,
  refundId: number,
  paymentReference?: string
): Promise<void> {
  const [providerRefund, referencedPayment] = await Promise.all([
    fetchRefund(refundId, AbortSignal.timeout(PROVIDER_READ_TIMEOUT_MS)),
    paymentReference === undefined
      ? Promise.resolve(null)
      : verifyTransaction(
          paymentReference,
          AbortSignal.timeout(PROVIDER_READ_TIMEOUT_MS)
        ),
  ]);
  if (!providerRefund.success) {
    throw new Error('paystack_refund_verification_unavailable');
  }
  const current = providerRefund.data;
  if (!Number.isSafeInteger(current.transaction) || current.transaction <= 0) {
    throw new Error('paystack_refund_transaction_invalid');
  }
  let resolvedPaymentReference = paymentReference;
  if (resolvedPaymentReference === undefined) {
    const fetchedPayment = await fetchPaystackPaymentById(
      current.transaction,
      AbortSignal.timeout(PROVIDER_READ_TIMEOUT_MS)
    );
    if (!fetchedPayment.success) {
      throw new Error('paystack_refund_payment_lookup_unavailable');
    }
    resolvedPaymentReference = fetchedPayment.data.reference;
    if (fetchedPayment.data.id !== current.transaction) {
      throw new Error('paystack_refund_payment_lookup_mismatch');
    }
  }
  if (
    typeof resolvedPaymentReference !== 'string' ||
    !/^[A-Za-z0-9_-]{1,100}$/.test(resolvedPaymentReference)
  ) {
    throw new Error('paystack_refund_payment_reference_invalid');
  }
  const providerPayment =
    referencedPayment ??
    (await verifyTransaction(
      resolvedPaymentReference,
      AbortSignal.timeout(PROVIDER_READ_TIMEOUT_MS)
    ));
  if (!providerPayment.success) {
    throw new Error('paystack_refund_verification_unavailable');
  }
  const original = providerPayment.data;
  if (
    current.id !== refundId ||
    current.transaction !== original.id ||
    original.reference !== resolvedPaymentReference ||
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
    .eq('gateway_reference', resolvedPaymentReference)
    .eq('transaction_type', 'payment')
    .eq('status', 'completed')
    .limit(2);
  if (paymentError) throw new Error('refund_event_payment_lookup_failed');
  const candidates = (payments ?? []) as RecoveryPayment[];
  const payment = candidates[0];
  if (candidates.length > 1) {
    // The reference resolves to completed payments on different orders and
    // redelivery cannot disambiguate them: persist one review per order so
    // ops can route the verified provider refund, then acknowledge.
    for (const candidate of candidates) {
      if (!candidate.order_id) continue;
      await fileRecoveryReviewOnce(supabase, {
        candidates: candidates.map((entry) => ({
          payment_transaction_id: entry.id,
          order_id: entry.order_id,
          amount: entry.amount,
          gateway_reference: entry.gateway_reference,
        })),
        merchantId: candidate.merchant_id,
        metadata: {
          provider_refund_id: refundId,
          provider_payment_transaction_id: original.id,
          reference: resolvedPaymentReference,
          audit_record_failed: true,
          recovered_from_provider_event: true,
        },
        orderId: candidate.order_id,
        // Deliberately unset: every candidate review shares this provider
        // refund, and the open-by-paystack-ref index would collapse all but
        // the first order's review.
        paystackRef: null,
        reason: `Paystack refund ${refundId} matches multiple completed payments for reference ${resolvedPaymentReference}`,
      });
    }
    logger.info({
      message:
        'Unknown Paystack refund event matches multiple completed payments',
      refundId,
    });
    return;
  }
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
      // The order/reference slot is held by a row that is not this Paystack
      // refund, so redelivery would collide forever: persist the verified
      // provider evidence for reconciliation, then acknowledge.
      await fileRecoveryReviewOnce(supabase, {
        candidates: [
          {
            payment_transaction_id: payment.id,
            order_id: payment.order_id,
            amount: payment.amount,
            gateway_reference: payment.gateway_reference,
          },
        ],
        merchantId: payment.merchant_id,
        metadata: {
          provider_refund_id: refundId,
          provider_payment_transaction_id: original.id,
          payment_transaction_id: payment.id,
          audit_record_failed: true,
          recovered_from_provider_event: true,
        },
        orderId: payment.order_id,
        paystackRef: String(refundId),
        reason: `Paystack refund ${refundId} collides with a non-refund transaction and cannot be recorded`,
      });
      logger.info({
        message: 'Unknown Paystack refund audit collides; review filed',
        refundId,
      });
      return;
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
