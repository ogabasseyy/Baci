import { buildCheckoutBillingAddress } from '../build-checkout-billing-address';
import { cancelStaleCheckoutOrder } from '../cancel-stale-checkout-order';
import { clearCheckoutIdempotencyKey } from '../checkout-idempotency';
import type { ResolvePendingCheckoutOrderResult } from '../pending-checkout-order';
import { initializeRedvaultPayment } from '../redvault-payment-response';
import type { RedvaultStatus } from './redvault-prepared-order-submit';

/**
 * Throws at module scope so call sites inside the component's try/catch
 * avoid the compiler's "ThrowStatement inside of try/catch" bailout.
 */
function raiseRedvaultSubmitError(message: string): never {
  throw new Error(message);
}

export interface ResolveRedvaultSubmitFenceOptions {
  fence: ResolvePendingCheckoutOrderResult;
  checkoutFingerprint: string;
  customerEmail: string;
  merchantId: string;
  firstName: string;
  lastName: string;
  customerPhone: string;
  finalAddress: string;
  finalCity: string;
  finalState: string;
  merchantCountry: string;
  waitForResolvedStorefrontCustomerAuth: () => Promise<boolean>;
  isOrderInFlightRef: { current: boolean };
  setIsProcessing: (value: boolean) => void;
  setRedvaultStatus: (status: RedvaultStatus) => void;
  clearPendingCheckoutOrder: () => void;
  clearCheckoutSession: () => void;
  clearCart: () => void;
  pushSuccessRoute: (path: string) => void;
}

/**
 * Applies the REDVAULT pending-order fence verdict to a checkout submit:
 * routes already-paid orders to the completed order, cancels blocking
 * orders before the lane recreates them, and replays a live stored order
 * instead of duplicating it.
 *
 * @returns true when the submit was fully handled (routed, redirected,
 * held, or waiting on reconciliation) and the caller must return; false
 * to continue with order creation or reuse.
 */
export async function resolveRedvaultSubmitFence({
  fence,
  checkoutFingerprint,
  customerEmail,
  merchantId,
  firstName,
  lastName,
  customerPhone,
  finalAddress,
  finalCity,
  finalState,
  merchantCountry,
  waitForResolvedStorefrontCustomerAuth,
  isOrderInFlightRef,
  setIsProcessing,
  setRedvaultStatus,
  clearPendingCheckoutOrder,
  clearCheckoutSession,
  clearCart,
  pushSuccessRoute,
}: ResolveRedvaultSubmitFenceOptions): Promise<boolean> {
  if (fence.redvaultUnresolved) {
    raiseRedvaultSubmitError(
      'Your UBA payment is still being verified. Do not pay again with another method until it completes.'
    );
  }

  // The fenced order already committed money (e.g. the webhook marked it
  // paid after the browser closed): route to the completed order instead
  // of recreating from the unchanged cart.
  if (fence.paidOrder) {
    const paidOrder = fence.paidOrder;
    clearPendingCheckoutOrder();
    await clearCheckoutIdempotencyKey(checkoutFingerprint);
    clearCheckoutSession();
    clearCart();
    setIsProcessing(false);
    isOrderInFlightRef.current = false;
    const successQuery = new URLSearchParams({
      orderId: paidOrder.orderId,
      email: customerEmail,
    });
    if (paidOrder.trackingToken) {
      successQuery.set('trackingToken', paidOrder.trackingToken);
    }
    pushSuccessRoute(`/order-success?${successQuery.toString()}`);
    return true;
  }

  // Entering REDVAULT with an ordinary order still pending: its hosted
  // payment may remain payable, so cancel it before the REDVAULT lane
  // creates another inventory-reserving order. Unlike the prepared-order
  // path (provably pre-init), an unreleasable ordinary order blocks the
  // lane instead of risking a duplicate live checkout.
  if (fence.ordinaryPendingOrder) {
    const ordinary = fence.ordinaryPendingOrder;
    const ordinaryCancel = await cancelStaleCheckoutOrder({
      isAuthenticated: await waitForResolvedStorefrontCustomerAuth(),
      orderId: ordinary.orderId,
      reason: 'Shopper switched to UBA payment',
      trackingToken: ordinary.trackingToken,
    });
    if (ordinaryCancel === 'live') {
      raiseRedvaultSubmitError(
        'Your previous order is still being processed. Please wait for it to complete before paying with UBA.'
      );
    }
    if (ordinaryCancel === 'failed') {
      raiseRedvaultSubmitError(
        'We could not release your previous order. Please try again.'
      );
    }
    clearPendingCheckoutOrder();
  }

  // Same-lane REDVAULT retry (reload or return from Paystack) with a
  // still-pending stored order: the new fingerprint takes a new
  // idempotency identity, so cancel the old order before submitting or
  // the lane opens a second inventory-reserving order while the old
  // hosted URL may still capture. An initializing order reports live
  // and blocks instead of duplicating.
  if (fence.redvaultPendingOrder) {
    const stale = fence.redvaultPendingOrder;
    const staleCancel = await cancelStaleCheckoutOrder({
      isAuthenticated: await waitForResolvedStorefrontCustomerAuth(),
      orderId: stale.orderId,
      reason: 'Shopper restarted UBA payment',
      trackingToken: stale.trackingToken,
    });
    if (staleCancel === 'live') {
      // The stored order already initialized (reload before following
      // the redirect): reopen its persisted authorization URL instead
      // of stranding the fenced order with no in-app path. The fence
      // stays — it still references this live order.
      setRedvaultStatus('pending');
      let replayResult: Awaited<
        ReturnType<typeof initializeRedvaultPayment>
      >;
      try {
        replayResult = await initializeRedvaultPayment({
          merchantId,
          orderId: stale.orderId,
          trackingToken: stale.trackingToken,
          // REDVAULT rails are NGN-only (attempt CHECK + paystack
          // gateway); the stamped order currency is authoritative
          // server-side, so NGN is the only sendable value that can
          // ever initialize here.
          currency: 'NGN',
          // The email persisted with the stored order: the payment
          // snapshot lookup rejects a current-form email the shopper
          // edited after the order was initialized.
          customerEmail: stale.customerEmail,
          customerName: `${firstName} ${lastName}`.trim(),
          customerPhone,
          billingAddress: buildCheckoutBillingAddress(
            finalAddress,
            finalCity,
            finalState,
            merchantCountry
          ),
        });
      } catch {
        setRedvaultStatus('error');
        setIsProcessing(false);
        isOrderInFlightRef.current = false;
        raiseRedvaultSubmitError(
          'We could not reopen your previous UBA payment. Please try again.'
        );
      }
      if (replayResult.kind === 'pending_reconciliation') {
        setIsProcessing(false);
        isOrderInFlightRef.current = false;
        return true;
      }
      if (replayResult.kind === 'captured_held') {
        setRedvaultStatus('held');
        setIsProcessing(false);
        isOrderInFlightRef.current = false;
        return true;
      }
      window.location.assign(replayResult.authorizationUrl);
      return true;
    }
    if (staleCancel === 'failed') {
      raiseRedvaultSubmitError(
        'We could not release your previous UBA payment. Please try again.'
      );
    }
    clearPendingCheckoutOrder();
  }

  if (fence.clearStoredOrder) {
    clearPendingCheckoutOrder();
  }
  return false;
}
