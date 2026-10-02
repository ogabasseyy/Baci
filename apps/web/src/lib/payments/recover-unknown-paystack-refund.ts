import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { fetchCompletedPaymentsByReference } from './fetch-completed-payments-by-reference';
import { fileCancelledPaystackRefundCandidateReviews } from './file-cancelled-paystack-refund-candidate-reviews';
import { fileInvalidPaystackRefundEvidenceReview } from './file-invalid-paystack-refund-evidence-review';
import { fileActiveOrderPaystackRefundCandidateReviews } from './file-provider-refund-outside-cancellation-review';
import { fileStalledPaystackRefundReviews } from './file-stalled-paystack-refund-reviews';
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
    // The provider answered for a real refund but its transaction
    // pointer is malformed — or the resolved payment reference is
    // missing/outside the recovery alphabet — so no payment can
    // resolve: throwing bare would 503 every redelivery with no
    // durable trace, and polling can never rediscover an unknown
    // refund. File the evidence against the webhook hint (or a
    // refund-keyed fallback when the event carries none) and still
    // throw for glitch recovery.
    if (
      error instanceof Error &&
      (error.message === 'paystack_refund_transaction_invalid' ||
        error.message === 'paystack_refund_payment_reference_invalid')
    ) {
      const raw = (error as { providerRefund?: unknown }).providerRefund as
        | {
            amount?: unknown;
            currency?: unknown;
            status?: unknown;
            transaction?: unknown;
          }
        | null
        | undefined;
      const reference = paymentReference ?? `unknown-refund:${refundId}`;
      const reason =
        error.message === 'paystack_refund_transaction_invalid'
          ? `Paystack refund ${refundId} returned a malformed transaction pointer for reference ${reference}`
          : `Paystack refund ${refundId} resolved a payment reference outside the recovery alphabet for reference ${reference}`;
      await fileInvalidPaystackRefundEvidenceReview(supabase, {
        evidence: {
          providerPaymentTransactionId: raw?.transaction,
          providerRefundId: refundId,
          providerRefundStatus:
            typeof raw?.status === 'string' ? raw.status : 'unknown',
          reference,
        },
        reason,
        reference,
        refundId,
      });
      await resolvePaystackRefundRecoveryWatch(supabase, {
        providerRefundId: refundId,
        reference,
      });
    }
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
    // The provider answered but its evidence is unusable: acknowledging
    // would drop the refund permanently (polling cannot rediscover an
    // unknown refund), so file it against the resolved payment's orders
    // and throw for redelivery instead. Merges are idempotent, so a
    // transient provider glitch recovers on redelivery while a
    // permanently malformed shape stays visible for operations.
    const invalidReason = `Paystack refund ${refundId} returned unusable provider evidence for reference ${resolvedPaymentReference}`;
    if (candidates.length === 0) {
      // No candidate orders for the order-scoped filers — but throwing
      // with no durable trace would let the malformed evidence vanish
      // with the last provider retry, so file the generic review
      // first. The throw still stands: a transient glitch recovers on
      // redelivery while the review keeps the wedge visible.
      await fileInvalidPaystackRefundEvidenceReview(supabase, {
        evidence,
        reason: invalidReason,
        reference: resolvedPaymentReference,
        refundId,
      });
      await resolvePaystackRefundRecoveryWatch(supabase, {
        providerRefundId: refundId,
        reference: resolvedPaymentReference,
      });
      throw new Error('paystack_refund_evidence_unmatched');
    }
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
    // The malformed evidence is durably filed: resolve the watch (a
    // no-op when none is open) so a later completion cannot claim it
    // and file stale evidence. The throw still stands for glitch
    // recovery on redelivery.
    await resolvePaystackRefundRecoveryWatch(supabase, {
      providerRefundId: refundId,
      reference: resolvedPaymentReference,
    });
    throw new Error('paystack_refund_evidence_invalid');
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
      if (stalledFiled > 0) return;
      // Both scans empty: a payment pending during the first read may
      // have completed before the stalled scan ran. Open the recovery
      // watch and re-scan atomically under the reference lock the
      // completion path claims under: rows returned mean the payment
      // landed first and loop around to handle them; an empty set
      // leaves the watch open so the completion files the evidence
      // instead of acknowledging silently.
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
