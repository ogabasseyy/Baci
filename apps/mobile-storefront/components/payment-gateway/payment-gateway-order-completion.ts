import { router } from 'expo-router';
import type { RefObject } from 'react';
import { releaseCheckoutPurchaseTracking } from '@/lib/claim-checkout-purchase-release';
import {
  claimCheckoutPurchaseTracking,
  isCheckoutPurchaseClaimed,
} from '@/lib/claim-checkout-purchase-tracking';
import { clearPersistedRedvaultOrderWithRetry } from '@/lib/pending-redvault-order';
import {
  clearRedvaultPurchaseTrackingContext,
  loadRedvaultPurchaseTrackingContext,
} from '@/lib/redvault-purchase-tracking-context';
import type { PaymentGatewayParams } from '@/schemas/payment-gateway';
import { trackCheckoutPaymentCompletedOnce } from '@/services/analytics';
import { verifyRedvaultPayment } from '@/services/redvault';
import { trackCheckoutRoutePurchaseCompleted } from '@/services/tiktok-checkout-route-tracking';
import type { PaymentStatusSetter } from './payment-gateway-controller.types';
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
 * Runs the `uba_redvault` provider-verification branch. On confirmation the
 * caller continues with the shared completion below; when the branch settles
 * the screen itself (pending/held/error/unmount) the caller must return.
 */
export async function verifyRedvaultCompletion(
  context: OrderCompletionContext
): Promise<{
  continueSharedCompletion: boolean;
  verifiedOrderNumber?: string;
}> {
  const {
    clearPendingLoadTimeout,
    isMountedRef,
    orderId,
    orderNumber,
    paymentCompletionStartedRef,
    reference,
    setErrorMessage,
    setPaymentStatus,
  } = context;

  paymentCompletionStartedRef.current = true;
  clearPendingLoadTimeout();
  setPaymentStatus('processing');
  try {
    const outcome = await verifyRedvaultPayment(reference || '');
    if (!isMountedRef.current) return { continueSharedCompletion: false };
    if (outcome === 'pending' || outcome === 'held') {
      setPaymentStatus(outcome);
      return { continueSharedCompletion: false };
    }
    const verifiedOrderNumber = outcome.orderNumber || orderNumber;
    // The persisted fence must clear now: otherwise the next submit
    // resolves this paid order, clears the new cart, and routes back
    // here instead of placing the new purchase. Retry transient
    // storage failures before degrading to best-effort — verification
    // already succeeded, so cleanup must never revert to pending.
    try {
      await clearPersistedRedvaultOrderWithRetry();
    } catch {
      // A fence that will not clear is left for the next resolver
      // pass; the verified payment still succeeds below.
    }
    try {
      const trackingContext = await loadRedvaultPurchaseTrackingContext(
        orderId || ''
      );
      if (trackingContext) {
        // The order-created path claims its own scoped key — emit only
        // on a fresh claim.
        if (await claimCheckoutPurchaseTracking(orderId || '')) {
          try {
            await trackCheckoutRoutePurchaseCompleted({
              ...trackingContext,
              orderId: orderId || '',
              orderNumber: verifiedOrderNumber || trackingContext.orderNumber,
            });
          } catch (trackingError) {
            // Unlike the shared completion helper, this branch owns
            // its claim directly: on rejection the persisted bare
            // purchase claim must roll back too, or the next verified
            // retry reads it as a recorded conversion, deletes the
            // retained context as stale, and loses the conversion
            // permanently. The context is retained for that retry.
            await releaseCheckoutPurchaseTracking(orderId || '');
            throw trackingError;
          }
          await clearRedvaultPurchaseTrackingContext(orderId || '');
        } else if (await isCheckoutPurchaseClaimed(orderId || '')) {
          // The claim is actually held, so the purchase went out
          // through another path: the saved context is stale and must
          // not linger in AsyncStorage indefinitely.
          await clearRedvaultPurchaseTrackingContext(orderId || '');
        }
        // Otherwise the store itself was unavailable (a denial is not
        // proof of emission): retain the context so a later retry
        // still has the email/phone/items snapshot — clearing here
        // would destroy the only copy without any purchase going out.
      }
    } catch {
      // Verification already succeeded; ignore analytics failures.
    }
    return { continueSharedCompletion: true, verifiedOrderNumber };
  } catch {
    if (!isMountedRef.current) return { continueSharedCompletion: false };
    setErrorMessage(
      'We could not confirm your UBA payment yet. Do not pay again; check your orders shortly.'
    );
    setPaymentStatus('pending');
    return { continueSharedCompletion: false };
  }
}

function buildOrderSuccessParams(
  context: OrderCompletionContext,
  verifiedOrderNumber: string | undefined,
  reconciliation?: 'order_cancelled' | 'order_skipped'
) {
  const {
    gateway,
    orderId,
    orderNumber,
    paymentMethod,
    reference,
    trackingToken,
  } = context;
  return {
    orderId: orderId || '',
    orderNumber: verifiedOrderNumber || orderNumber || '',
    // The selected method, not the rails gateway: a REDVAULT success
    // routed as `paystack` would join the settlement poll set, and a
    // late Once-helper emission there would re-emit the ad purchase the
    // REDVAULT branch already owns (the denied-claim fail-closed path
    // cannot retry through it).
    paymentMethod: paymentMethod ?? gateway,
    reference: reference || '',
    ...(reconciliation && { reconciliation }),
    ...(trackingToken && { trackingToken }),
  };
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
  setPaymentStatus('success');
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
      });
      // Same unmount hazard across the fallible tracking call: stop
      // before clearCart when the screen is gone.
      if (!isMountedRef.current) {
        return;
      }
    } else if (verification.terminalFailure) {
      // Definitive gateway outcome: the payment cannot settle, so keep
      // the cart and the error/retry path instead of navigating to a
      // false "Order Confirmed".
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
  await clearCart();
  scheduleDelayedNavigation(() => {
    router.replace({
      pathname: '/order-success',
      params: buildOrderSuccessParams(context, verifiedOrderNumber),
    });
  });
}
