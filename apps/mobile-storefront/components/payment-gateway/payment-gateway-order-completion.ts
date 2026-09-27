import { router } from 'expo-router';
import type { RefObject } from 'react';
import type { PaymentGatewayParams } from '@/schemas/payment-gateway';
import {
  trackCheckoutPaymentCompletedOnce,
  trackCheckoutPaymentFailed,
} from '@/services/analytics';
import type { PaymentStatusSetter } from './payment-gateway-controller.types';
import { buildOrderSuccessParams } from './payment-gateway-success-params';
import { settleRedvaultFunnelCompletion } from './settle-redvault-funnel-completion';
import { verifyOrderPaymentForCompletion } from './verify-order-payment';

/**
 * Shared state for the order-completion step functions below. The factory in
 * `payment-gateway-completion-handlers` builds one per completion pass so
 * each step stays a focused, independently testable unit.
 */
export interface OrderCompletionContext {
  amount?: number;
  clearCart: () => void | Promise<void>;
  clearPendingLoadTimeout: () => void;
  gateway?: PaymentGatewayParams['gateway'];
  isMountedRef: RefObject<boolean>;
  orderId?: string;
  orderNumber?: string;
  orderTotal?: number;
  paymentCompletionStartedRef: RefObject<boolean>;
  /**
   * Selected checkout method (e.g. `uba_redvault` on Paystack rails):
   * lanes that attribute the conversion must prefer this over
   * `gateway`, which names the rails, not the method.
   */
  paymentMethod?: string;
  reference?: string;
  scheduleDelayedNavigation: (navigate: () => void) => void;
  setErrorMessage: (message: string | null) => void;
  setPaymentStatus: PaymentStatusSetter;
  trackingToken?: string;
}

/**
 * Shared completion after verification: a server-confirmed settlement
 * check, a single conversion emission, then cart clear and success
 * routing. Provider-verified REDVAULT payments skip the generic
 * verification block — the REDVAULT branch already owns the ad
 * purchase emission, so only the funnel payment_completed is emitted
 * below under its own claim; a lagging tracked row must not override
 * a provider-confirmed success with an error or a second emission.
 */
export async function settleOrderCompletion(
  context: OrderCompletionContext,
  verifiedOrderNumber: string | undefined,
  redvaultVerified: boolean
): Promise<void> {
  const {
    amount,
    clearCart,
    clearPendingLoadTimeout,
    gateway,
    isMountedRef,
    orderId,
    orderNumber,
    orderTotal,
    paymentCompletionStartedRef,
    paymentMethod,
    reference,
    scheduleDelayedNavigation,
    setErrorMessage,
    setPaymentStatus,
    trackingToken,
  } = context;

  paymentCompletionStartedRef.current = true;
  clearPendingLoadTimeout();
  // Stay processing until verification decides: an early success would
  // render "Payment Successful!" and terminally ignore later provider
  // cancellation/error callbacks while verification is still running.
  setPaymentStatus('processing');
  if (orderId && !redvaultVerified) {
    // Prefer the canonical order total: `amount` is only the residual due
    // at the gateway after wallet/savings credits.
    const purchaseTotal = orderTotal ?? amount ?? 0;
    // A completion-looking redirect proves association, not settlement:
    // only a server-confirmed paid order records the conversion here.
    // Unverified orders still navigate to success, where settlement
    // polling may complete them once the webhook marks them paid.
    const verification = await verifyOrderPaymentForCompletion({
      orderId,
      trackingToken,
      reference,
    });
    // The shopper may have left while verification was pending (up to
    // its full timeout): a late response must not record a conversion
    // or erase the cart after unmount — a new storefront cart built
    // since would be destroyed even though navigation refuses to run.
    if (!isMountedRef.current) {
      return;
    }
    if (verification.paid) {
      // The tracked order already carries the checkout identity,
      // breakdown, and line items: forward them so the durable claim is
      // consumed with full attribution (later polling cannot enrich it).
      // First completion wins the durable claim; replays emit nothing.
      await trackCheckoutPaymentCompletedOnce({
        customerEmail: verification.customerEmail,
        customerPhone: verification.customerPhone,
        items: verification.items,
        orderId,
        orderNumber: orderNumber || orderId,
        paymentMethod: gateway || 'payment_gateway',
        reference,
        shipping: verification.shipping,
        subtotal: verification.subtotal,
        tax: verification.tax,
        value: verification.total ?? purchaseTotal,
        // Stamped order currency from the tracked-order lookup: without
        // it the NGN default corrupts non-NGN completions and fallback
        // purchase emissions.
        ...(verification.currency ? { currency: verification.currency } : {}),
      });
      // Same unmount hazard across the fallible tracking call: stop
      // before clearCart when the screen is gone.
      if (!isMountedRef.current) {
        return;
      }
    } else if (verification.terminalFailure) {
      // Definitive gateway outcome: the payment cannot settle, so keep
      // the cart and the error/retry path instead of navigating to a
      // false "Order Confirmed". Initialization already emitted
      // payment_started for this attempt, so the funnel failure must be
      // recorded here with the canonical total — otherwise every
      // provider-declined attempt strands unmatched.
      await trackCheckoutPaymentFailed(
        verification.terminalFailure,
        orderId,
        gateway || 'payment_gateway',
        reference,
        undefined,
        purchaseTotal
      );
      paymentCompletionStartedRef.current = false;
      setPaymentStatus('error');
      setErrorMessage(
        verification.terminalFailure === 'cancelled'
          ? 'Payment was cancelled before completion. You can try again.'
          : 'Payment could not be confirmed. Please try again.'
      );
      return;
    } else if (verification.reconciliation) {
      // Captured money with no active paid order: route to the
      // reconciliation state instead of the generic confirmation. The
      // cart stays intact for a fresh attempt; settlement polling is
      // skipped there since a cancelled order can never become paid.
      setPaymentStatus('success');
      scheduleDelayedNavigation(() => {
        router.replace({
          pathname: '/order-success',
          params: buildOrderSuccessParams(
            context,
            orderNumber,
            verification.reconciliation
          ),
        });
      });
      return;
    }
  }
  if (orderId && redvaultVerified) {
    // Provider-verified REDVAULT payments skip the generic verification
    // block above: a lagging tracked row must not override the
    // provider-confirmed success with an error, and the REDVAULT branch
    // already owns the ad purchase emission under the purchase claim.
    // The funnel-only lane below owns the canonical payment_completed;
    // a shopper who left while its claim was pending must not lose a
    // newer cart to the cleanup below.
    const completionVisible = await settleRedvaultFunnelCompletion({
      amount,
      gateway,
      isMountedRef,
      orderId,
      orderNumber,
      orderTotal,
      paymentMethod,
      reference,
    });
    if (!completionVisible) {
      return;
    }
  }
  setPaymentStatus('success');
  await clearCart();
  scheduleDelayedNavigation(() => {
    router.replace({
      pathname: '/order-success',
      params: buildOrderSuccessParams(context, verifiedOrderNumber),
    });
  });
}
