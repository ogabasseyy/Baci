import type { RefObject } from 'react';
import { releaseCheckoutPurchaseTracking } from '@/lib/claim-checkout-purchase-release';
import {
  claimCheckoutPurchaseTracking,
  markCheckoutPurchaseEmitted,
} from '@/lib/claim-checkout-purchase-tracking';
import type { PaymentGatewayParams } from '@/schemas/payment-gateway';
import {
  PAYMENT_COMPLETED_CLAIM_EVENT,
  trackCheckoutPaymentCompleted,
} from '@/services/analytics';
import { serializeAfterOrderCreated } from '@/services/serialize-after-order-created';

export interface RedvaultFunnelCompletionInput {
  amount?: number;
  gateway?: PaymentGatewayParams['gateway'];
  isMountedRef: RefObject<boolean>;
  orderId: string;
  orderNumber?: string;
  orderTotal?: number;
  /**
   * Selected checkout method (the native REDVAULT route initializes
   * Paystack rails with `paymentMethod: 'uba_redvault'`): the funnel
   * attribution must use this, never the rails gateway.
   */
  paymentMethod?: string;
  reference?: string;
}

/**
 * Funnel-only `payment_completed` for a provider-verified REDVAULT
 * payment. The REDVAULT branch already owns the ad purchase emission
 * under the `purchase` claim, so this lane claims the
 * `payment_completed` key and emits the funnel event only — routing
 * through the once-helper would re-emit the ad purchase under the
 * other claim key. A denied claim records nothing (fail closed: an
 * unclaimed emission could be duplicated by a later restored callback
 * or reopened screen, and there is no retry lane here). Resolves
 * whether the screen is still mounted after the claim awaits so the
 * caller can skip the cart side effect for a shopper who already left.
 */
export async function settleRedvaultFunnelCompletion({
  amount,
  gateway,
  isMountedRef,
  orderId,
  orderNumber,
  orderTotal,
  paymentMethod,
  reference,
}: RedvaultFunnelCompletionInput): Promise<boolean> {
  // Canonical order total: `amount` is only the residual due at the
  // gateway after wallet/savings credits, but funnel revenue is the
  // whole order.
  const purchaseTotal = orderTotal ?? amount ?? 0;
  await serializeAfterOrderCreated(orderId, async () => {
    if (!isMountedRef.current) {
      return;
    }
    const claimed = await claimCheckoutPurchaseTracking(
      orderId,
      PAYMENT_COMPLETED_CLAIM_EVENT
    );
    // Recheck after the claim await: leaving mid-claim must suppress
    // the late emission as well as the cart side effect. A granted claim
    // on a gone screen is released (never-rejecting) so a later callback
    // or reopened screen can still record the conversion.
    if (!claimed) {
      return;
    }
    if (!isMountedRef.current) {
      await releaseCheckoutPurchaseTracking(
        orderId,
        PAYMENT_COMPLETED_CLAIM_EVENT
      );
      return;
    }
    trackCheckoutPaymentCompleted({
      orderId,
      orderNumber: orderNumber || orderId,
      paymentMethod: paymentMethod || gateway || 'uba_redvault',
      ...(reference ? { reference } : {}),
      value: purchaseTotal,
    });
    // Emission proof for crash recovery: without it an aged lease reads
    // orphaned after a restart and the completion event double-emits.
    await markCheckoutPurchaseEmitted(orderId, PAYMENT_COMPLETED_CLAIM_EVENT);
  });
  return isMountedRef.current;
}
