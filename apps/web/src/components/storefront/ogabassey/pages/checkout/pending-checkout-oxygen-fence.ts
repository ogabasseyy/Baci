import { checkoutFingerprintsMatch } from './checkout-fingerprints-match';
import type {
  ResolvePendingCheckoutOrderOptions,
  ResolvePendingCheckoutOrderResult,
} from './pending-checkout-order';
import {
  fetchFencedOrderState,
  isPaidOrderState,
  paidOrderIdentity,
} from './pending-checkout-redvault-fence';

export const oxygenPreviousPaymentUnresolved =
  'Your previous payment may still be active. Please complete it or contact support before starting another payment.';

/** Never discard an unresolved Oxygen order and silently create another. */
export function clearOrderUnlessOxygenIsUnresolved(
  oxygenOrder: boolean
): ResolvePendingCheckoutOrderResult {
  if (oxygenOrder) throw new Error(oxygenPreviousPaymentUnresolved);
  return { reusableOrder: null, clearStoredOrder: true };
}

/** Preserve a potentially payable previous order when Oxygen changes lanes. */
export async function resolveOxygenCheckoutFence({
  pendingOrder,
  merchantId,
  merchantSlug,
  customerEmail,
  checkoutFingerprint,
  paymentMethod,
  fetchImpl = fetch,
}: ResolvePendingCheckoutOrderOptions): Promise<ResolvePendingCheckoutOrderResult | null> {
  if (
    !pendingOrder ||
    pendingOrder.merchantId !== merchantId ||
    (paymentMethod !== 'oxygen' && pendingOrder.paymentMethod !== 'oxygen')
  )
    return null;

  const sameIdentity =
    pendingOrder.customerEmail.trim().toLowerCase() ===
      customerEmail.trim().toLowerCase() &&
    checkoutFingerprintsMatch(
      pendingOrder.checkoutFingerprint,
      checkoutFingerprint
    );
  const mayReuseOxygenOrder =
    pendingOrder.paymentMethod === 'oxygen' && sameIdentity;
  if (mayReuseOxygenOrder && pendingOrder.trackingToken) return null;

  if (pendingOrder.trackingToken && pendingOrder.orderId) {
    const existing = await fetchFencedOrderState({
      fetchImpl,
      merchantSlug,
      pendingOrder,
    });
    if (existing && isPaidOrderState(existing)) {
      return {
        reusableOrder: null,
        clearStoredOrder: true,
        paidOrder: paidOrderIdentity(pendingOrder, existing),
      };
    }
  }
  throw new Error(oxygenPreviousPaymentUnresolved);
}
