import type { SupabaseClient } from '@supabase/supabase-js';
import type { CompletedPaymentMatch } from './fetch-completed-payments-by-reference';
import { fileCancelledPaystackRefundCandidateReviews } from './file-cancelled-paystack-refund-candidate-reviews';
import {
  fileInvalidPaystackRefundEvidenceReview,
  fileUnclaimedPaystackRefundCandidateReview,
} from './file-invalid-paystack-refund-evidence-review';
import type { RefundRecoveryEvidence } from './file-paystack-refund-candidate-reviews';
import { fileActiveOrderPaystackRefundCandidateReviews } from './file-provider-refund-outside-cancellation-review';
import { resolvePaystackRefundRecoveryWatch } from './resolve-paystack-refund-recovery-watch';

/**
 * File provider evidence the refund read-back returned in an unusable
 * shape, then throw for redelivery: acknowledging would drop the
 * refund permanently (polling cannot rediscover an unknown refund),
 * so it files against the resolved payment's orders first. Merges are
 * idempotent, so a transient provider glitch recovers on redelivery
 * while a permanently malformed shape stays visible for operations.
 * Always throws; the error distinguishes the no-candidate wedge from
 * the filed-then-rethrow path.
 */
export async function fileUnusablePaystackRefundEvidence(
  supabase: SupabaseClient,
  {
    candidates,
    current,
    evidence,
    reference,
    refundId,
  }: {
    candidates: CompletedPaymentMatch[];
    current: {
      amount: number;
      currency: string;
      status: string;
    };
    evidence: RefundRecoveryEvidence;
    reference: string;
    refundId: number;
  }
): Promise<never> {
  const invalidReason = `Paystack refund ${refundId} returned unusable provider evidence for reference ${reference}`;
  if (candidates.length === 0) {
    // No candidate orders for the order-scoped filers — but throwing
    // with no durable trace would let the malformed evidence vanish
    // with the last provider retry, so file the generic review
    // first. The throw still stands: a transient glitch recovers on
    // redelivery while the review keeps the wedge visible.
    await fileInvalidPaystackRefundEvidenceReview(supabase, {
      evidence,
      reason: invalidReason,
      reference,
      refundId,
    });
    await resolvePaystackRefundRecoveryWatch(supabase, {
      providerRefundId: refundId,
      reference,
    });
    throw new Error('paystack_refund_evidence_unmatched');
  }
  const invalidCancelledFiled =
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
  const invalidActiveFiled =
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
  // Order-less matches are skipped by both queues: file them
  // generically so every match is durably retained before the
  // rethrow below.
  await fileUnclaimedPaystackRefundCandidateReview(supabase, {
    candidates,
    evidence,
    filed: [invalidCancelledFiled, invalidActiveFiled],
    reason: invalidReason,
    reference,
    refundId,
  });
  // The malformed evidence is durably filed: resolve the watch (a
  // no-op when none is open) so a later completion cannot claim it
  // and file stale evidence. The throw still stands for glitch
  // recovery on redelivery.
  await resolvePaystackRefundRecoveryWatch(supabase, {
    providerRefundId: refundId,
    reference,
  });
  throw new Error('paystack_refund_evidence_invalid');
}
