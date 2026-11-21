import { clearCheckoutIdempotencyKey } from './checkout-idempotency';
import { checkoutFingerprintsMatch } from './checkout-fingerprints-match';
import type {
  ResolvePendingCheckoutOrderOptions,
  ResolvePendingCheckoutOrderResult,
} from './pending-checkout-order';
import {
  fetchFencedOrderState,
  isNonReusableOrderState,
  isPaidOrderState,
  isProgressedButUnpaidOrderState,
  paidOrderIdentity,
} from './pending-checkout-redvault-fence';
import { readBankOfferCheckoutReference } from './persist-pending-checkout-order';
import { recoverBankOfferCheckoutOrder } from './recover-bank-offer-checkout-order';

export async function resolveBankOfferPendingCheckout({
  pendingOrder,
  merchantId,
  merchantSlug,
  customerEmail,
  checkoutFingerprint,
  paymentMethod,
  fetchImpl = fetch,
}: Omit<
  ResolvePendingCheckoutOrderOptions,
  'shippingProvider'
>): Promise<ResolvePendingCheckoutOrderResult | null> {
  if (
    !pendingOrder ||
    (paymentMethod !== 'bank_card_offer' &&
      pendingOrder.paymentMethod !== 'bank_card_offer')
  )
    return null;
  if (pendingOrder.merchantId !== merchantId) return null;
  const emailMatches =
    pendingOrder.customerEmail.trim().toLowerCase() ===
    customerEmail.trim().toLowerCase();
  if (pendingOrder.paymentMethod !== 'bank_card_offer' && !emailMatches)
    return null;
  const message =
    'Check your existing order or contact support before starting another payment.';
  if (!pendingOrder.trackingToken) throw new Error(message);
  const existing = await fetchFencedOrderState({
    fetchImpl,
    merchantSlug,
    pendingOrder,
  });
  if (!existing) {
    return { reusableOrder: null, clearStoredOrder: true };
  }
  if (existing.id !== pendingOrder.orderId) throw new Error(message);
  if (isPaidOrderState(existing)) {
    if (!emailMatches) throw new Error(message);
    if (
      pendingOrder.paymentMethod === 'bank_card_offer' ||
      existing.payment_method === 'bank_card_offer'
    ) {
      const reference = readBankOfferCheckoutReference(merchantId, pendingOrder.orderId);
      if (!reference || !checkoutFingerprintsMatch(checkoutFingerprint, pendingOrder.checkoutFingerprint)) {
        throw new Error(message);
      }
      // A paid snapshot can outlive a Paystack reversal. The success
      // route must verify the reference before clearing checkout state.
      return {
        reusableOrder: null,
        clearStoredOrder: false,
        bankOfferVerification: { orderId: pendingOrder.orderId, reference },
      };
    }
    return {
      reusableOrder: null,
      clearStoredOrder: true,
      paidOrder: paidOrderIdentity(pendingOrder, existing),
    };
  }
  if (
    !isProgressedButUnpaidOrderState(existing) &&
    isNonReusableOrderState(existing)
  ) {
    await clearCheckoutIdempotencyKey(pendingOrder.checkoutFingerprint);
    return { reusableOrder: null, clearStoredOrder: true };
  }
  if (
    !emailMatches ||
    paymentMethod !== 'bank_card_offer' ||
    !checkoutFingerprintsMatch(
      checkoutFingerprint,
      pendingOrder.checkoutFingerprint
    )
  )
    throw new Error(message);
  const recoverable = recoverBankOfferCheckoutOrder(existing, pendingOrder);
  if (!recoverable) throw new Error(message);
  return recoverable;
}
