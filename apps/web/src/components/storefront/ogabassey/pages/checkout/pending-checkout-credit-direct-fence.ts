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

/** Only the automatic reduction of an already consumed wallet balance may differ. */
export function walletCreditDirectFingerprintsMatch(
  input: ResolvePendingCheckoutOrderOptions
): boolean {
  const pending = input.pendingOrder;
  if (!hasWalletCreditDirectOrder(input) || !pending) return false;
  if (
    checkoutFingerprintsMatch(
      pending.checkoutFingerprint,
      input.checkoutFingerprint
    )
  )
    return true;
  try {
    const before: unknown = JSON.parse(pending.checkoutFingerprint);
    const after: unknown = JSON.parse(input.checkoutFingerprint);
    if (
      !before ||
      !after ||
      typeof before !== 'object' ||
      typeof after !== 'object' ||
      Array.isArray(before) ||
      Array.isArray(after)
    )
      return false;
    const oldCheckout = before as Record<string, unknown>;
    const newCheckout = after as Record<string, unknown>;
    return (
      oldCheckout.useWalletCredit === true &&
      typeof newCheckout.useWalletCredit === 'boolean' &&
      oldCheckout.walletAmountUsed === pending.walletAmountUsed &&
      newCheckout.walletAmountUsed === 0 &&
      checkoutFingerprintsMatch(
        JSON.stringify(oldCheckout),
        JSON.stringify({
          ...newCheckout,
          useWalletCredit: true,
          walletAmountUsed: pending.walletAmountUsed,
        })
      )
    );
  } catch {
    return false;
  }
}

/** A wallet refresh must not discard an order with an unresolved lender leg. */
export async function resolveWalletCreditDirectFence(
  input: ResolvePendingCheckoutOrderOptions
): Promise<ResolvePendingCheckoutOrderResult | null> {
  if (!hasWalletCreditDirectOrder(input) || !input.pendingOrder) return null;
  const pendingOrder = input.pendingOrder;
  // Method changes still pass through the server's durable reservation guard.
  if (pendingOrder.trackingToken && walletCreditDirectFingerprintsMatch(input))
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
