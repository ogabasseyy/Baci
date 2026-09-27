import { useRef } from 'react';
import { trackCheckoutPaymentFailed } from '@/services/analytics';
import type { BNPLRecordCheckoutFailure } from './use-bnpl-checkout-controller';

export interface BNPLFailureRecorderParams {
  orderId?: string;
  gateway?: string;
  /**
   * Validated order total (not a residual due): a failed BNPL attempt
   * must still attribute the full order revenue.
   */
  orderTotal?: string;
}

/**
 * Attempt-scoped BNPL failure recorder: duplicate provider error
 * redirects and late load-error callbacks for the same attempt emit a
 * single payment_failed. A ref (not state) so the guard holds
 * synchronously across rerenders; reset only by Retry.
 */
export function useBNPLFailureRecorder({
  orderId,
  gateway,
  orderTotal,
}: BNPLFailureRecorderParams): {
  recordCheckoutFailure: BNPLRecordCheckoutFailure;
  resetCheckoutFailure: () => void;
} {
  const failureRecordedRef = useRef(false);
  return {
    recordCheckoutFailure: (reason, reference) => {
      if (failureRecordedRef.current) {
        return;
      }
      failureRecordedRef.current = true;
      void trackCheckoutPaymentFailed(
        reason,
        orderId,
        gateway,
        reference,
        undefined,
        orderTotal ? Number(orderTotal) : undefined
      );
    },
    resetCheckoutFailure: () => {
      failureRecordedRef.current = false;
    },
  };
}
