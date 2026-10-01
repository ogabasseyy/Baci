import type { SupabaseClient } from '@supabase/supabase-js';
import type { initiateRefund as initiatePaystackRefund } from '@/lib/initiate-paystack-refund';
import type { GatewayPaymentTransaction } from '@/lib/orders/gateway-payment-transaction';
import { quarantineRefund } from '@/lib/orders/quarantine-order-cancellation-refund';
import {
  DeferredError,
  DeliveryUncertainError,
} from '@/lib/orders/run-order-cancellation-side-effect';

type RefundFailure = Extract<
  Awaited<ReturnType<typeof initiatePaystackRefund>>,
  { success: false }
>;

/**
 * Quarantine a leg whose provider initiation failed, then throw the
 * matching error. Ambiguous failures (the provider may have accepted)
 * quarantine terminally and throw delivery-uncertain; deterministic
 * rejections quarantine for operations and throw retryable. Definite
 * transient failures (rate limit, missing secret) stay review-free
 * while retries remain, but file expiring evidence on the last
 * attempt since the drain never reselects attempts-capped rows.
 */
export async function handlePaystackCancellationRefundFailure({
  isLastAttempt,
  order,
  paystackRefund,
  refundIds,
  supabase,
  transaction,
}: {
  isLastAttempt?: boolean;
  order: { currency: string | null; id: string; merchant_id: string };
  paystackRefund: RefundFailure;
  refundIds: number[];
  supabase: Pick<SupabaseClient, 'from' | 'rpc'>;
  transaction: GatewayPaymentTransaction;
}): Promise<never> {
  const isAmbiguousFailure =
    paystackRefund.code === 'NETWORK_ERROR' ||
    paystackRefund.code?.startsWith('HTTP_5');
  // A rate-limited, unconfigured, or unauthenticated leg was definitely
  // not accepted: nothing reached Paystack, so quarantining terminally
  // would strand the remaining legs after the accepted ones settle —
  // or, for a missing or rotated secret, strand the customer unrefunded
  // behind a delivery_uncertain row that never retries after recovery.
  // Throw retryable instead — the drain defers while accepted legs are
  // in flight, then resumes here with settled legs skipped. Ambiguous
  // and deterministic failures still quarantine below: the provider
  // may have accepted, or never will.
  const isDefiniteTransientFailure =
    paystackRefund.code === 'HTTP_429' ||
    paystackRefund.code === 'HTTP_401' ||
    paystackRefund.code === 'HTTP_403' ||
    paystackRefund.code === 'CONFIG_ERROR';
  // Transient legs stay review-free while retries remain — but the
  // drain never reselects attempts-capped rows, so a transient
  // failure on the last attempt must file durable evidence instead
  // of stranding the leg while cron reports success.
  const isExhaustedTransientFailure =
    isDefiniteTransientFailure && isLastAttempt === true;
  if (refundIds.length > 0 && !isDefiniteTransientFailure) {
    await quarantineRefund({
      metadata: {
        accepted_refund_ids: refundIds,
        failed_payment_transaction_id: transaction.id,
        // An ambiguous later failure may still have created a provider
        // refund: mark it so the completion gate never auto-closes the
        // review on other legs' evidence. Recorded explicitly either
        // way so lone failed-leg IDs never read as legacy ambiguity.
        ambiguous_initiation: isAmbiguousFailure,
      },
      order,
      reason:
        'Some payment legs were accepted for refund, but a later leg failed',
      supabase,
      transactions: [transaction],
    });
  } else if (!isDefiniteTransientFailure) {
    // No accepted legs yet and the provider will not take this leg on
    // retry: an ambiguous failure may still have created a provider
    // refund no reconciler could discover, while a deterministic
    // rejection (bad reference, invalid amount) would only burn the
    // five-attempt budget and strand the customer unrefunded without
    // a review. File the leg for operations either way.
    await quarantineRefund({
      metadata: {
        failed_payment_transaction_id: transaction.id,
        // Explicit either way: a deterministic rejection must
        // auto-close on replacement coverage, not read as legacy
        // ambiguity.
        ambiguous_initiation: isAmbiguousFailure,
      },
      order,
      // A deterministic rejection accepted nothing, so a transient
      // review-write failure must stay retryable: terminalizing
      // here would strand the customer unrefunded with no review
      // after a temporary database failure. Ambiguous failures
      // may still have created a provider refund, so they keep
      // the terminal quarantine.
      preflight: !isAmbiguousFailure,
      reason: isAmbiguousFailure
        ? 'Paystack refund initiation failed ambiguously and may already exist for this payment leg'
        : 'Paystack refund initiation was rejected for this payment leg',
      supabase,
      transactions: [transaction],
    });
  } else if (isExhaustedTransientFailure) {
    const configExhausted = paystackRefund.code === 'CONFIG_ERROR';
    const authExhausted =
      paystackRefund.code === 'HTTP_401' || paystackRefund.code === 'HTTP_403';
    try {
      await quarantineRefund({
        metadata: {
          ...(refundIds.length > 0 ? { accepted_refund_ids: refundIds } : {}),
          failed_payment_transaction_id: transaction.id,
          // A 429, missing secret, or rejected credential is a definite
          // non-acceptance: explicit false so the completion gate
          // auto-closes on replacement coverage.
          ambiguous_initiation: false,
          ...(configExhausted
            ? { config_exhausted: true }
            : authExhausted
              ? { auth_exhausted: true }
              : { rate_limit_exhausted: true }),
        },
        order,
        // The provider rejected every attempt, so a replacement
        // refund can still proceed: no ambiguous-initiation marker,
        // letting the completion gate auto-close this review on
        // coverage. Preflight stays set even with accepted legs —
        // they are audited before any later leg runs, so a deferred
        // retry observes them via the awaiting-provider check
        // instead of re-initiating.
        preflight: true,
        reason:
          refundIds.length > 0
            ? configExhausted
              ? 'Some payment legs were accepted for refund, but a later leg could not be attempted on any retry because Paystack was not configured'
              : authExhausted
                ? 'Some payment legs were accepted for refund, but a later leg was rejected on every retry because the Paystack credentials were invalid'
                : 'Some payment legs were accepted for refund, but a later leg was rate limited on every retry'
            : configExhausted
              ? 'Paystack refund initiation could not be attempted on any retry because Paystack was not configured'
              : authExhausted
                ? 'Paystack refund initiation was rejected on every retry because the Paystack credentials were invalid'
                : 'Paystack refund initiation was rate limited on every retry for this payment leg',
        supabase,
        transactions: [transaction],
      });
    } catch (error) {
      if (error instanceof DeliveryUncertainError) throw error;
      // The review write or merge failed on the last attempt: a
      // plain retryable error would strand the leg without evidence
      // since the budget is spent, so defer instead — deferred rows
      // reselect without the attempts cap until the review lands.
      throw new DeferredError(
        error instanceof Error ? error.message : String(error)
      );
    }
  }
  const RefundError = isAmbiguousFailure ? DeliveryUncertainError : Error;
  throw new RefundError(paystackRefund.error);
}
