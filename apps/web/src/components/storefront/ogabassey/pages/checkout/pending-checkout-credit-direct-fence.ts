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

const pendingMessage =
  'Your Credit Direct payment may still be active. Return to your existing order or contact support before paying again.';

export function hasWalletCreditDirectOrder(
  input: ResolvePendingCheckoutOrderOptions
): boolean {
  const pending = input.pendingOrder;
  return (
    pending?.paymentMethod === 'credit_direct' &&
    Number.isFinite(pending.walletAmountUsed) &&
    (pending.walletAmountUsed ?? 0) > 0 &&
    pending.merchantId === input.merchantId &&
    pending.customerEmail.trim().toLowerCase() ===
      input.customerEmail.trim().toLowerCase()
  );
}

/** A wallet refresh must not discard an order with an unresolved lender leg. */
export async function resolveWalletCreditDirectFence(
  input: ResolvePendingCheckoutOrderOptions
): Promise<ResolvePendingCheckoutOrderResult | null> {
  if (!hasWalletCreditDirectOrder(input) || !input.pendingOrder) return null;
  const pendingOrder = input.pendingOrder;
  // A match continues through the normal saved-order status lookup and
  // /api/orders/reuse. Only the server may authorize a method change, including
  // when the wallet selection was cleared after a confirmed debit.
  if (
    pendingOrder.trackingToken &&
    checkoutFingerprintsMatch(
      pendingOrder.checkoutFingerprint,
      input.checkoutFingerprint,
      pendingOrder.walletAmountUsed
    )
  )
    return null;
  if (pendingOrder.trackingToken && pendingOrder.orderId) {
    const existing = await fetchFencedOrderState({
      fetchImpl: input.fetchImpl ?? fetch,
      merchantSlug: input.merchantSlug,
      pendingOrder,
    });
    if (existing && isPaidOrderState(existing))
      return {
        reusableOrder: null,
        clearStoredOrder: true,
        paidOrder: paidOrderIdentity(pendingOrder, existing),
      };
  }
  throw new Error(pendingMessage);
}
