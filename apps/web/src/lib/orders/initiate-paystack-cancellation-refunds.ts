import type { SupabaseClient } from '@supabase/supabase-js';
import { initiateRefund as initiatePaystackRefund } from '@/lib/initiate-paystack-refund';
import {
  type BankOfferRefundEvidence,
  beginBankCardOfferRefundDispatch,
} from '@/lib/orders/begin-bank-card-offer-refund-dispatch';
import type { GatewayPaymentTransaction } from '@/lib/orders/gateway-payment-transaction';
import { handlePaystackCancellationRefundFailure } from '@/lib/orders/handle-paystack-cancellation-refund-failure';
import { quarantineRefund } from '@/lib/orders/quarantine-order-cancellation-refund';
import { recordPaystackCancellationRefund } from '@/lib/orders/record-paystack-cancellation-refund';
import { tryResetCancellationSideEffectAttempts } from '@/lib/orders/reset-cancellation-side-effect-attempts';
import { verifyTransaction } from '@/lib/paystack';
import { bankCardOfferReferenceSchema } from '@/schemas/bank-card-offer-reference';
import {
  DeferredError,
  PartialCancellationRefundError,
} from './run-order-cancellation-side-effect';

// Reserve a complete provider call and time to persist its outcome.
const REFUND_PROVIDER_CALL_WORST_MS = 30_000;
const REFUND_AUDIT_WRITE_RESERVE_MS = 8_000;
const BANK_OFFER_VERIFY_BUDGET_MS = 8_000;
export const REFUND_INITIATION_LEG_BUDGET_MS =
  REFUND_PROVIDER_CALL_WORST_MS + REFUND_AUDIT_WRITE_RESERVE_MS;

function formatVerifiedKobo(amountKobo: number): string {
  const digits = String(amountKobo).padStart(3, '0');
  return `${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

/**
 * Initiate a Paystack refund for every gateway leg that has no recorded
 * completed refund, auditing each accepted refund before moving on. Returns
 * the accepted provider refund IDs. Throws on the first leg that cannot
 * proceed; quarantine paths file a reconciliation review first.
 */
export async function initiatePaystackCancellationRefunds({
  claimToken,
  deadlineMs,
  isLastAttempt,
  order,
  reason,
  refundedPaymentIds,
  supabase,
  transactions,
}: {
  claimToken?: string;
  deadlineMs?: number;
  /**
   * Set when this run consumes the final retry attempt: a
   * transiently-failing leg must file durable evidence instead of
   * throwing retryable, since the drain never reselects
   * attempts-capped rows.
   */
  isLastAttempt?: boolean;
  order: {
    currency: string | null;
    id: string;
    merchant_id: string;
    order_number: string | null;
    payment_method?: string | null;
  };
  reason?: string;
  refundedPaymentIds: Set<string>;
  supabase: Pick<SupabaseClient, 'from' | 'rpc'>;
  transactions: GatewayPaymentTransaction[];
}): Promise<number[]> {
  const refundIds: number[] = [];
  const bankOfferLegsForReview: GatewayPaymentTransaction[] = [];
  let bankOfferLookupUnavailable = false;

  for (const transaction of transactions) {
    if (refundedPaymentIds.has(transaction.id)) continue;
    const transactionAmount = Number(transaction.amount);
    const isBankOffer = bankCardOfferReferenceSchema.safeParse(
      transaction.gateway_reference
    ).success;
    // A malformed reserved reference or an offer order with a mismatched
    // reference needs review before any refund lookup or provider call.
    if (
      !isBankOffer &&
      (order.payment_method === 'bank_card_offer' ||
        transaction.gateway_reference?.startsWith('BCO-'))
    ) {
      bankOfferLegsForReview.push(transaction);
      continue;
    }
    let koboAmount = isBankOffer ? 0 : Math.round(transactionAmount * 100);
    let dispatchEvidence: BankOfferRefundEvidence | undefined;
    // A sub-kobo amount would round to zero and request a full refund.
    if (!isBankOffer && transactionAmount > 0 && koboAmount <= 0) {
      await quarantineRefund({
        metadata: {
          failed_payment_transaction_id: transaction.id,
          ambiguous_initiation: false,
          leg_amount: transaction.amount,
        },
        order,
        reason:
          'Payment leg amount rounds to zero kobo and needs review before refund',
        supabase,
        transactions: [transaction],
      });
      continue;
    }
    if (isBankOffer) {
      const reference = transaction.gateway_reference as string;
      const identity = {
        p_order_id: order.id,
        p_merchant_id: order.merchant_id,
        p_transaction_id: transaction.id,
        p_reference: reference,
      };
      const capture = await supabase.rpc(
        'get_bank_card_offer_refundable_amount',
        identity
      );
      if (capture.error) {
        bankOfferLookupUnavailable = true;
        if (isLastAttempt) bankOfferLegsForReview.push(transaction);
        continue;
      }
      if (!Number.isSafeInteger(capture.data) || capture.data <= 0) {
        bankOfferLegsForReview.push(transaction);
        continue;
      }
      koboAmount = capture.data;
      const verifyBudgetMs =
        deadlineMs === undefined
          ? BANK_OFFER_VERIFY_BUDGET_MS
          : Math.min(
              BANK_OFFER_VERIFY_BUDGET_MS,
              deadlineMs - Date.now() - REFUND_INITIATION_LEG_BUDGET_MS
            );
      if (verifyBudgetMs > 0) {
        if (!claimToken) {
          bankOfferLookupUnavailable = true;
          if (isLastAttempt) bankOfferLegsForReview.push(transaction);
          continue;
        }
        const verification = await verifyTransaction(
          reference,
          AbortSignal.timeout(verifyBudgetMs),
          { textIds: true }
        );
        if (!verification.success) {
          bankOfferLookupUnavailable = true;
          if (isLastAttempt) bankOfferLegsForReview.push(transaction);
          continue;
        }
        const { data } = verification;
        if (
          data?.status !== 'success' ||
          data.reference !== reference ||
          data.currency.toUpperCase() !== 'NGN' ||
          data.amount !== koboAmount ||
          !('domain' in data) ||
          (data.domain !== 'test' && data.domain !== 'live')
        ) {
          bankOfferLegsForReview.push(transaction);
          continue;
        }
        dispatchEvidence = {
          ...identity,
          p_claim_token: claimToken,
          p_provider_id: data.id,
          p_provider_domain: data.domain,
          p_amount_kobo: koboAmount,
        };
      }
    }
    // Compute the budget after reading the saved capture. A plain
    // Error keeps the step retryable, so unattempted legs run on the
    // next tick instead of stranding a mid-flight claim. Legs start
    // only when a full provider call plus the audit reserve both fit;
    // the provider timeout excludes the reserve so an accepted refund
    // always has margin to persist before the worker is killed.
    const timeoutMs =
      deadlineMs === undefined ? undefined : deadlineMs - Date.now();
    const providerTimeoutMs =
      timeoutMs === undefined
        ? undefined
        : timeoutMs - REFUND_AUDIT_WRITE_RESERVE_MS;
    if (
      (isBankOffer && !dispatchEvidence) ||
      (timeoutMs !== undefined && timeoutMs < REFUND_INITIATION_LEG_BUDGET_MS)
    ) {
      // On the final attempt the claim has already raised the row to
      // the attempts cap, so a plain retryable error would finish it
      // as failed-with-five-attempts — a state the drain never
      // reselects — stranding this never-attempted leg with no
      // review. Defer with a fresh budget when the reset lands so
      // the resume attempts the leg; when the reset fails the budget
      // is spent, so quarantine the leg with durable evidence
      // instead of returning a retryable failure that cannot retry.
      if (isLastAttempt === true) {
        const resetFailed = await tryResetCancellationSideEffectAttempts(
          supabase,
          order.id,
          'refund'
        );
        if (!resetFailed) {
          throw new DeferredError(
            'cancellation_refund_deadline_deferred_for_budget'
          );
        }
        await quarantineRefund({
          metadata: {
            ...(refundIds.length > 0 ? { accepted_refund_ids: refundIds } : {}),
            failed_payment_transaction_id: transaction.id,
            // Definite non-acceptance: the deadline expired before
            // the provider was called, so no refund may exist and
            // the completion gate auto-closes on replacement
            // coverage.
            ambiguous_initiation: false,
            deadline_exhausted: true,
          },
          order,
          reason:
            'The cancellation refund deadline expired on the final attempt before this payment leg could be attempted',
          supabase,
          transactions: [transaction],
        });
      }
      throw new Error('cancellation_refund_deadline_exceeded');
    }
    if (dispatchEvidence) {
      const admission = await beginBankCardOfferRefundDispatch({
        evidence: dispatchEvidence,
        order,
        refundIds,
        supabase,
        transaction,
      });
      if (admission === 'unavailable') {
        bankOfferLookupUnavailable = true;
        if (isLastAttempt) bankOfferLegsForReview.push(transaction);
        continue;
      }
      if (admission === 'already_admitted') continue;
      if (admission !== 'dispatch') {
        bankOfferLegsForReview.push(transaction);
        continue;
      }
    }
    const paystackRefund = await initiatePaystackRefund(
      transaction.gateway_reference as string,
      koboAmount,
      reason || 'Order cancelled',
      providerTimeoutMs
    );
    if (!paystackRefund.success) {
      await handlePaystackCancellationRefundFailure({
        isLastAttempt,
        order,
        paystackRefund,
        refundIds,
        supabase,
        transaction,
      });
      continue;
    }
    refundIds.push(
      await recordPaystackCancellationRefund({
        order,
        paystackRefund,
        reason,
        supabase,
        transaction,
        transactionAmount: isBankOffer
          ? formatVerifiedKobo(koboAmount)
          : transactionAmount,
      })
    );
  }
  if (bankOfferLegsForReview.length > 0) {
    await quarantineRefund({
      metadata: {
        accepted_refund_ids: refundIds,
        // This worker never submitted the quarantined legs to Paystack.
        ambiguous_initiation: false,
        ...(bankOfferLookupUnavailable
          ? { bank_offer_capture_lookup_unavailable: true }
          : {}),
      },
      order,
      reason:
        isLastAttempt && bankOfferLookupUnavailable
          ? 'Bank card offer refund verification was unavailable on the final attempt'
          : 'Bank card offer refund does not match the verified capture',
      supabase,
      transactions: bankOfferLegsForReview,
    });
  }
  if (bankOfferLookupUnavailable)
    throw new PartialCancellationRefundError(refundIds);
  return refundIds;
}
