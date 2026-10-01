import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { fetchCompletedPaymentsByReference } from './fetch-completed-payments-by-reference';
import { fileCancelledPaystackRefundCandidateReviews } from './file-cancelled-paystack-refund-candidate-reviews';
import { fileActiveOrderPaystackRefundCandidateReviews } from './file-provider-refund-outside-cancellation-review';
import { fileStalledPaystackRefundReviews } from './file-stalled-paystack-refund-reviews';
import { recordRecoveredPaystackRefund } from './record-recovered-paystack-refund';
import { verifyUnknownPaystackRefundProvider } from './verify-unknown-paystack-refund-provider';

/**
 * Recover a provider refund the signed event references but no local audit
 * row records — e.g. a merchant-created replacement for a failed automatic
 * refund. A signed event is only a wake-up hint: the refund and its payment
 * are re-verified with Paystack, the payment must be the order's single
 * completed leg on a cancelled order, and only then is a local audit row
 * recorded and reconciled through the standard transition. Events that
 * cannot be verified throw so Paystack can redeliver; verified refunds
 * on active orders are filed for operations, since polling can never
 * rediscover a provider-only refund after acknowledgement.
 */
export async function recoverUnknownPaystackRefund(
  supabase: SupabaseClient,
  refundId: number,
  paymentReference?: string
): Promise<void> {
  const { current, resolvedPaymentReference } =
    await verifyUnknownPaystackRefundProvider(refundId, paymentReference);
  const candidates = await fetchCompletedPaymentsByReference(
    supabase,
    resolvedPaymentReference
  );
  const payment = candidates[0];
  const evidence = {
    providerPaymentTransactionId: current.transaction,
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
    const invalidReason = `Paystack refund ${refundId} returned unusable provider evidence for reference ${resolvedPaymentReference}`;
    await fileCancelledPaystackRefundCandidateReviews(
      supabase,
      candidates,
      evidence,
      invalidReason
    );
    // The cancellation queue drops active orders, but a potentially
    // refunded active order must not rely on provider redeliveries
    // alone: persist the malformed evidence to the non-cancellation
    // queue too, so it stays visible after retries stop. Amounts are
    // sanitized because the provider shape is unusable by definition.
    await fileActiveOrderPaystackRefundCandidateReviews(
      supabase,
      candidates,
      evidence,
      invalidReason,
      {
        amount:
          Number.isSafeInteger(current.amount) && current.amount > 0
            ? current.amount / 100
            : 0,
        currency:
          typeof current.currency === 'string' ? current.currency : 'unknown',
        status: typeof current.status === 'string' ? current.status : 'unknown',
      }
    );
    throw new Error('paystack_refund_evidence_invalid');
  }
  if (candidates.length > 1) {
    // The reference resolves to completed payments on different orders and
    // redelivery cannot disambiguate them: persist one review per
    // cancelled order so ops can route the verified provider refund,
    // then acknowledge. Active-order matches stay out of the
    // cancellation queue but still need operations eyes, so they file
    // into the non-cancellation queue below.
    const reason = `Paystack refund ${refundId} matches multiple completed payments for reference ${resolvedPaymentReference}`;
    await fileCancelledPaystackRefundCandidateReviews(
      supabase,
      candidates,
      evidence,
      reason
    );
    await fileActiveOrderPaystackRefundCandidateReviews(
      supabase,
      candidates,
      evidence,
      reason,
      {
        amount: current.amount / 100,
        currency: current.currency,
        status: current.status,
      }
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
      refund: {
        amount: current.amount / 100,
        currency: current.currency,
        status: current.status,
      },
      refundId,
    });
    return;
  }
  await recordRecoveredPaystackRefund(supabase, {
    current,
    evidence,
    payment: { ...payment, order_id: payment.order_id },
    refundId,
  });
}
