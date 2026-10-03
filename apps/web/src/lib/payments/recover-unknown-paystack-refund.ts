import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { fetchCompletedPaymentsByReference } from './fetch-completed-payments-by-reference';
import { fileCancelledPaystackRefundCandidateReviews } from './file-cancelled-paystack-refund-candidate-reviews';
import {
  fileInvalidPaystackRefundEvidenceReview,
  fileUnclaimedPaystackRefundCandidateReview,
} from './file-invalid-paystack-refund-evidence-review';
import { fileInvalidRefundEvidenceBeforeReject } from './file-invalid-refund-evidence-before-reject';
import { fileActiveOrderPaystackRefundCandidateReviews } from './file-provider-refund-outside-cancellation-review';
import { fileStalledPaystackRefundReviews } from './file-stalled-paystack-refund-reviews';
import { fileUnusablePaystackRefundEvidence } from './file-unusable-paystack-refund-evidence';
import { openPaystackRefundRecoveryWatch } from './open-paystack-refund-recovery-watch';
import { recordRecoveredPaystackRefund } from './record-recovered-paystack-refund';
import { resolvePaystackRefundRecoveryWatch } from './resolve-paystack-refund-recovery-watch';
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
  let verified: Awaited<ReturnType<typeof verifyUnknownPaystackRefundProvider>>;
  try {
    verified = await verifyUnknownPaystackRefundProvider(
      refundId,
      paymentReference
    );
  } catch (error) {
    await fileInvalidRefundEvidenceBeforeReject(supabase, {
      error,
      paymentReference,
      refundId,
    });
    throw error;
  }
  const { current, resolvedPaymentReference } = verified;
  let candidates = await fetchCompletedPaymentsByReference(
    supabase,
    resolvedPaymentReference
  );
  const evidence = {
    providerPaymentTransactionId: current.transaction,
    providerRefundId: refundId,
    // Coerced: the malformed-evidence branch below files with this same
    // object, and a non-string verdict must fail closed downstream as
    // non-failed rather than poison the exclusion check.
    providerRefundStatus:
      typeof current.status === 'string' ? current.status : 'unknown',
    reference: resolvedPaymentReference,
  };
  if (
    current.id !== refundId ||
    !Number.isSafeInteger(current.amount) ||
    current.amount <= 0 ||
    typeof current.currency !== 'string' ||
    typeof current.status !== 'string'
  ) {
    await fileUnusablePaystackRefundEvidence(supabase, {
      candidates,
      current,
      evidence,
      reference: resolvedPaymentReference,
      refundId,
    });
  }
  for (let pass = 0; ; pass++) {
    const payment = candidates[0];
    if (candidates.length > 1) {
      // The reference resolves to completed payments on different orders
      // and redelivery cannot disambiguate them: persist one review per
      // cancelled order so ops can route the verified provider refund,
      // then acknowledge. Active-order matches stay out of the
      // cancellation queue but still need operations eyes, so they file
      // into the non-cancellation queue below.
      const reason = `Paystack refund ${refundId} matches multiple completed payments for reference ${resolvedPaymentReference}`;
      const multiCancelledFiled =
        await fileCancelledPaystackRefundCandidateReviews(
          supabase,
          candidates,
          evidence,
          reason
        );
      const multiActiveFiled =
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
      // Order-less matches are skipped by both queues: file them
      // generically so every match is durably retained before the
      // acknowledge below.
      await fileUnclaimedPaystackRefundCandidateReview(supabase, {
        candidates,
        evidence,
        filed: [multiCancelledFiled, multiActiveFiled],
        reason,
        reference: resolvedPaymentReference,
        refundId,
      });
      // Every match is retained in a durable review: resolve the
      // watch (a no-op when this run never opened one) so a later
      // unrelated completion cannot claim it and file stale
      // evidence against an already-handled refund.
      await resolvePaystackRefundRecoveryWatch(supabase, {
        providerRefundId: refundId,
        reference: resolvedPaymentReference,
      });
      logger.info({
        message:
          'Unknown Paystack refund event matches multiple completed payments',
        refundId,
      });
      return;
    }
    if (candidates.length !== 1 || !payment || !payment.order_id) {
      const detached = candidates.length === 1 ? candidates[0] : undefined;
      if (detached && !detached.order_id) {
        // The sole completed payment was already detached when scanned
        // (order_id null — e.g. the order FK's ON DELETE SET NULL fired
        // before the first read): the verified refund is still a real
        // merchant debit, so retain it in the order-independent queue
        // instead of opening a watch whose rescan returns the same
        // detached row and acknowledges with no audit row or review.
        // Mirrors the post-scan deletion branch in
        // recordRecoveredPaystackRefund; merges are idempotent, so the
        // rescan pass refiling is safe.
        await fileInvalidPaystackRefundEvidenceReview(supabase, {
          evidence: {
            providerPaymentTransactionId: evidence.providerPaymentTransactionId,
            providerRefundId: refundId,
            providerRefundStatus: evidence.providerRefundStatus,
            reference: evidence.reference,
          },
          reason: `Paystack refund ${refundId} verified for reference ${resolvedPaymentReference} but its completed payment is detached from any order; route the merchant debit manually`,
          reference: resolvedPaymentReference,
          refundId,
        });
        await resolvePaystackRefundRecoveryWatch(supabase, {
          providerRefundId: refundId,
          reference: resolvedPaymentReference,
        });
        logger.info({
          message:
            'Unknown Paystack refund event payment is detached from any order',
          refundId,
        });
        return;
      }
      if (pass > 0) {
        // Stable empty under the watch: the first scan and the stalled
        // scan were both empty, and the watch opener below re-scanned
        // atomically with the watch insert. Acknowledge with no
        // further I/O — the open watch is the handoff: a payment
        // completing after the scan claims it on completion and files
        // the evidence, so no completion slips through unhandled.
        // Never re-run the stalled scan here: its queries would reopen
        // a completion window the atomic recheck just closed.
        return;
      }
      // No completed local payment: a stale pending attempt may already
      // have captured and been refunded before the sweep examined it.
      // Retain the verified provider evidence instead of treating it as
      // unrelated.
      const stalledFiled = await fileStalledPaystackRefundReviews(supabase, {
        evidence,
        gatewayReference: resolvedPaymentReference,
        refund: {
          amount: current.amount / 100,
          currency: current.currency,
          status: current.status,
        },
        refundId,
      });
      // A payment completing after the first scan but before the
      // stalled scan appears in neither result: returning on stalled
      // evidence alone would acknowledge without a watch for that
      // newly completed payment to claim. Open the recovery watch and
      // re-scan atomically under the reference lock the completion
      // path claims under even when stalled evidence was filed: rows
      // returned loop around to be handled, while an empty set
      // returns with the evidence filed and the watch open so a later
      // completion files its evidence instead of acknowledging
      // silently.
      candidates = await openPaystackRefundRecoveryWatch(supabase, {
        evidence: {
          amount_minor: current.amount,
          currency: current.currency,
          provider_payment_transaction_id: current.transaction,
          provider_refund_status: current.status,
        },
        providerRefundId: refundId,
        reference: resolvedPaymentReference,
      });
      if (stalledFiled > 0 && candidates.length === 0) return;
      continue;
    }
    if (pass === 0) {
      // The decisive scan ran without the reference lock: a payment
      // completing after the final read would leave this supposedly
      // stable single candidate silently ambiguous, finalizing the
      // wrong cancellation with no handoff. Re-scan atomically under
      // the lock the completion path claims under before recovering:
      // rows returned mean the payment landed first (loop around to
      // handle them, including a newly visible ambiguity), while the
      // open watch catches completions that land after the rescan.
      candidates = await openPaystackRefundRecoveryWatch(supabase, {
        evidence: {
          amount_minor: current.amount,
          currency: current.currency,
          provider_payment_transaction_id: current.transaction,
          provider_refund_status: current.status,
        },
        providerRefundId: refundId,
        reference: resolvedPaymentReference,
      });
      continue;
    }
    await recordRecoveredPaystackRefund(supabase, {
      current,
      evidence,
      payment: { ...payment, order_id: payment.order_id },
      refundId,
    });
    // The refund is durably recorded (or its evidence filed): resolve
    // the watch so a later unrelated completion cannot claim it.
    await resolvePaystackRefundRecoveryWatch(supabase, {
      providerRefundId: refundId,
      reference: resolvedPaymentReference,
    });
    return;
  }
}
