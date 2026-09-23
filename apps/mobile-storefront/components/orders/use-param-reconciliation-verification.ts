import { useEffect, useState } from 'react';
import { verifyOrderPaymentForCompletion } from '@/components/payment-gateway/verify-order-payment';

interface ParamReconciliationVerificationInput {
  isParamReconciliation: boolean;
  orderId?: string;
  trackingToken?: string;
  reference?: string;
  /**
   * Bounded retries for inconclusive (transient) verification. A
   * reconciliation deep link that hits a network/parse failure must
   * re-verify on its own — without a retry the effect dependencies
   * never change and the screen stays blank until remount.
   */
  maxAttempts?: number;
  retryDelayMs?: number;
}

/**
 * Proof-binds the caller-controlled reconciliation route parameter
 * before the screen renders the reconciliation state. A verified-absent
 * param resolves false (ordinary success flow); an inconclusive lookup
 * retries with backoff and stays pending instead of coercing to either
 * view, so a spoofed param can never borrow success credibility.
 * Extracted from the order-success screen (300-line file limit).
 */
export function useParamReconciliationVerification({
  isParamReconciliation,
  orderId,
  trackingToken,
  reference,
  maxAttempts = 3,
  retryDelayMs = 750,
}: ParamReconciliationVerificationInput): boolean | undefined {
  const [verified, setVerified] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    setVerified(undefined);
    if (!isParamReconciliation || !orderId) {
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
      }).then((result) => {
        if (cancelled) {
          return;
        }
        if (result.inconclusive && !result.reconciliation) {
          attempt += 1;
          if (attempt < maxAttempts) {
            retryTimer = setTimeout(runVerification, retryDelayMs * attempt);
          }
          return;
        }
        setVerified(!!result.reconciliation);
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
    maxAttempts,
    retryDelayMs,
  ]);

  return verified;
}
