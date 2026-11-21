import { useEffect, useState } from 'react';
import {
  type OrderPaymentVerification,
  verifyOrderPaymentForCompletion,
} from '@/components/payment-gateway/verify-order-payment';
import { deferredBankOfferCart } from '@/lib/deferred-bank-offer-cart';

interface ParamReconciliationVerificationInput {
  isParamReconciliation: boolean;
  orderId?: string;
  trackingToken?: string;
  reference?: string;
  requireVerifiedPayment?: boolean;
  /**
   * Bounded retries for inconclusive (transient) verification. A
   * reconciliation deep link that hits a network/parse failure must
   * re-verify on its own — without a retry the effect dependencies
   * never change and the screen stays blank until remount.
   */
  maxAttempts?: number;
  retryDelayMs?: number;
}

export interface ParamReconciliationVerification {
  /**
   * true = param proof-bound; false = verified absent (ordinary success
   * flow); undefined = still resolving. Fail-closed: undefined is never
   * success, and exhaustion (below) is never success either.
   */
  verified: boolean | undefined;
  reconciliation: OrderPaymentVerification['reconciliation'] | 'payment_failed';
  /**
   * True once the bounded retries are spent while the lookup stays
   * inconclusive (e.g. a network/API outage), or immediately when the
   * reconciliation param carries no order id (nothing can verify). The
   * caller should leave the blank pending state for an explicit error
   * state with `retry`.
   */
  exhausted: boolean;
  /** Restart bounded verification after exhaustion (or re-run on demand). */
  retry: () => void;
}

/**
 * Proof-binds the caller-controlled reconciliation route parameter
 * before the screen renders the reconciliation state. A verified-absent
 * param resolves false (ordinary success flow); an inconclusive lookup
 * retries with backoff and stays pending instead of coercing to either
 * view, so a spoofed param can never borrow success credibility. Once
 * the bounded attempts are spent while still inconclusive, `exhausted`
 * flips so the caller can offer an explicit retry instead of stranding
 * the deep link on a blank screen.
 * Extracted from the order-success screen (300-line file limit).
 */
export function useParamReconciliationVerification({
  isParamReconciliation,
  orderId,
  trackingToken,
  reference,
  requireVerifiedPayment = false,
  maxAttempts = 3,
  retryDelayMs = 750,
}: ParamReconciliationVerificationInput): ParamReconciliationVerification {
  const [outcome, setOutcome] = useState<
    ParamReconciliationVerification['reconciliation'] | false
  >(undefined);
  const [exhausted, setExhausted] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: retryNonce intentionally retriggers bounded verification after exhaustion; the attempt counter restarts inside the effect on each run.
  useEffect(() => {
    setOutcome(undefined);
    setExhausted(false);
    if (!isParamReconciliation) {
      return;
    }
    if (!orderId) {
      // Malformed deep link (reconciliation param without an order id):
      // no verification can run, so surface exhaustion immediately —
      // the gate renders the explicit error state with retry and
      // continue-shopping instead of stranding the screen blank.
      setExhausted(true);
      return;
    }
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    const runVerification = () => {
      void verifyOrderPaymentForCompletion({
        orderId,
        trackingToken,
        reference,
      }).then(async (result) => {
        if (cancelled) {
          return;
        }
        if (requireVerifiedPayment && result.terminalFailure) {
          setOutcome('payment_failed');
          return;
        }
        if (
          !result.reconciliation &&
          !result.paid &&
          (result.inconclusive || requireVerifiedPayment)
        ) {
          attempt += 1;
          if (attempt < maxAttempts) {
            retryTimer = setTimeout(runVerification, retryDelayMs * attempt);
            return;
          }
          // Bounded attempts spent while still inconclusive: stop
          // scheduling, stay fail-closed (verified remains undefined),
          // and surface exhaustion so the screen can offer a retry.
          setExhausted(true);
          return;
        }
        if (requireVerifiedPayment && result.paid && reference) {
          await deferredBankOfferCart
            .clearIfUnchanged(orderId, reference, () => !cancelled)
            .catch(() =>
              console.warn('Could not clear the verified bank-offer cart')
            );
        }
        if (!cancelled) setOutcome(result.reconciliation ?? false);
      });
    };
    runVerification();
    return () => {
      cancelled = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
    };
  }, [
    isParamReconciliation,
    orderId,
    trackingToken,
    reference,
    requireVerifiedPayment,
    maxAttempts,
    retryDelayMs,
    retryNonce,
  ]);

  // Plain closure: React Compiler handles memoization (AGENTS.md).
  const retry = () => {
    setRetryNonce((nonce) => nonce + 1);
  };

  return {
    verified: outcome === undefined ? undefined : outcome !== false,
    reconciliation: outcome || undefined,
    exhausted,
    retry,
  };
}
