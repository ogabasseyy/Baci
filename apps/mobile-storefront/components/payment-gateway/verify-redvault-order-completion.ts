import { releaseCheckoutPurchaseTracking } from '@/lib/claim-checkout-purchase-release';
import {
  claimCheckoutPurchaseTracking,
  isCheckoutPurchaseClaimedSettled,
} from '@/lib/claim-checkout-purchase-tracking';
import { clearPersistedRedvaultOrderWithRetry } from '@/lib/pending-redvault-order';
import {
  clearRedvaultPurchaseTrackingContext,
  loadRedvaultPurchaseTrackingContext,
} from '@/lib/redvault-purchase-tracking-context';
import { verifyRedvaultPayment } from '@/services/redvault';
import { trackCheckoutRoutePurchaseCompleted } from '@/services/tiktok-checkout-route-tracking';
import type { OrderCompletionContext } from './payment-gateway-order-completion';

/**
 * Runs the `uba_redvault` provider-verification branch. On confirmation the
 * caller continues with the shared completion below; when the branch settles
 * the screen itself (pending/held/error/unmount) the caller must return.
 * Extracted from payment-gateway-order-completion (300-line file limit).
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
        } else if (await isCheckoutPurchaseClaimedSettled(orderId || '')) {
          // The claim is actually held, so the purchase went out
          // through another path: the saved context is stale and must
          // not linger in AsyncStorage indefinitely. Settled read: a
          // phantom timed-out write must not destroy the only snapshot
          // copy before its rollback lands.
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
