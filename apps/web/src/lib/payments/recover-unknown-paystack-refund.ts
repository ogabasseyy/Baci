import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { selectPaystackRefundReference } from '@/lib/select-paystack-refund-reference';
import { fetchPaystackPaymentById } from './fetch-paystack-payment-by-id';
import { fetchRefund } from './fetch-paystack-refund';
import { fileCancelledPaystackRefundCandidateReviews } from './file-cancelled-paystack-refund-candidate-reviews';
import { filePaystackRefundRecoveryReview } from './file-paystack-refund-recovery-review';
import { fileRefundEvidenceReview } from './file-refund-evidence-review';
import { fileStalledPaystackRefundReviews } from './file-stalled-paystack-refund-reviews';
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
 * recorded and reconciled through the standard transition. Events that
 * cannot be verified throw so Paystack can redeliver; unrelated verified
 * payments are acknowledged without touching existing rows.
 */
export async function recoverUnknownPaystackRefund(
  supabase: SupabaseClient,
  refundId: number,
  paymentReference?: string
): Promise<void> {
  const providerRefund = await fetchRefund(
    refundId,
    AbortSignal.timeout(PROVIDER_READ_TIMEOUT_MS)
  );
  if (!providerRefund.success) {
    throw new Error('paystack_refund_verification_unavailable');
  }
  const current = providerRefund.data;
  if (!Number.isSafeInteger(current.transaction) || current.transaction <= 0) {
    throw new Error('paystack_refund_transaction_invalid');
  }
  // Always resolve the payment from the refund's own numeric transaction
  // ID: the webhook reference is only a hint and may be stale. A stale
  // hint is logged but never blocks recovery of the verified refund.
  const fetchedPayment = await fetchPaystackPaymentById(
    current.transaction,
    AbortSignal.timeout(PROVIDER_READ_TIMEOUT_MS)
  );
  if (!fetchedPayment.success) {
    throw new Error('paystack_refund_payment_lookup_unavailable');
  }
  if (fetchedPayment.data.id !== current.transaction) {
    throw new Error('paystack_refund_payment_lookup_mismatch');
  }
  const resolvedPaymentReference = fetchedPayment.data.reference;
  if (
    paymentReference !== undefined &&
    paymentReference !== resolvedPaymentReference
  ) {
    logger.info({
      message:
        'Unknown Paystack refund event reference is stale; using the authoritative payment',
      refundId,
    });
  }
  // The recovery path shares the webhook's reference alphabet: a reference
  // the selector will not pick is unusable downstream.
  if (
    typeof resolvedPaymentReference !== 'string' ||
    selectPaystackRefundReference(resolvedPaymentReference, undefined) !==
      resolvedPaymentReference
  ) {
    throw new Error('paystack_refund_payment_reference_invalid');
  }
  // Fetch every completed match (no LIMIT): the ambiguity branch files
  // one review per order, so truncating here would silently drop orders
  // from a corrupt/ambiguous reference shared across payments.
  const { data: payments, error: paymentError } = await supabase
    .from('transactions')
    .select('id, order_id, merchant_id, gateway_reference, amount')
    .eq('gateway', 'paystack')
    .eq('gateway_reference', resolvedPaymentReference)
    .eq('transaction_type', 'payment')
    .eq('status', 'completed');
  if (paymentError) throw new Error('refund_event_payment_lookup_failed');
  const candidates = (payments ?? []) as RecoveryPayment[];
  const payment = candidates[0];
  const evidence = {
    providerPaymentTransactionId: fetchedPayment.data.id,
    providerRefundId: refundId,
    reference: resolvedPaymentReference,
  };
  if (
    current.id !== refundId ||
    !Number.isSafeInteger(current.amount) ||
    current.amount <= 0 ||
    typeof current.currency !== 'string' ||
    typeof current.status !== 'string'
  ) {
    // The provider answered but its evidence is unusable: acknowledging
    // would drop the refund permanently (polling cannot rediscover an
    // unknown refund), so file it against the resolved payment's orders
    // and throw for redelivery instead. Merges are idempotent, so a
    // transient provider glitch recovers on redelivery while a
    // permanently malformed shape stays visible for operations.
    if (candidates.length === 0)
      throw new Error('paystack_refund_evidence_unmatched');
    await fileCancelledPaystackRefundCandidateReviews(
      supabase,
      candidates,
      evidence,
      `Paystack refund ${refundId} returned unusable provider evidence for reference ${resolvedPaymentReference}`
    );
    throw new Error('paystack_refund_evidence_invalid');
  }
  if (candidates.length > 1) {
    // The reference resolves to completed payments on different orders and
    // redelivery cannot disambiguate them: persist one review per
    // cancelled order so ops can route the verified provider refund,
    // then acknowledge. Active-order matches are merchant evidence and
    // stay out of the cancellation queue.
    await fileCancelledPaystackRefundCandidateReviews(
      supabase,
      candidates,
      evidence,
      `Paystack refund ${refundId} matches multiple completed payments for reference ${resolvedPaymentReference}`
    );
    logger.info({
      message:
        'Unknown Paystack refund event matches multiple completed payments',
      refundId,
    });
    return;
  }
  if (candidates.length !== 1 || !payment || !payment.order_id) {
    // No completed local payment: a stale pending attempt may already have
    // captured and been refunded before the sweep examined it. Retain the
    // verified provider evidence instead of treating it as unrelated.
    await fileStalledPaystackRefundReviews(supabase, {
      evidence,
      gatewayReference: resolvedPaymentReference,
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
      provider_payment_transaction_id: evidence.providerPaymentTransactionId,
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
      await filePaystackRefundRecoveryReview(supabase, {
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
          provider_payment_transaction_id:
            evidence.providerPaymentTransactionId,
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
      provider_payment_transaction_id: evidence.providerPaymentTransactionId,
      provider_refund_status: current.status.toLowerCase(),
      recovered_from_provider_event: true,
    },
    status: 'refund_pending',
  });
}
