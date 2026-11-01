import { clearCheckoutIdempotencyKey } from '@/components/storefront/ogabassey/pages/checkout/checkout-idempotency';
import { CHECKOUT_PENDING_ORDER_STORAGE_KEY } from '@/components/storefront/ogabassey/pages/checkout/pending-checkout-order';
import type { CartContextType } from '@/hooks/cart';
import { oxygenOwnedPendingCheckoutSchema } from '@/schemas/oxygen-checkout-snapshot';
import {
  clearOxygenCheckoutSnapshot,
  readOxygenCheckoutSnapshot,
} from './oxygen-checkout-snapshot';

/** Clear only the recovery record proven to belong to this completed order. */
export async function cleanupOxygenCompletedCheckout(
  orderId: string,
  merchantId: string,
  context?: {
    merchantSlug: string;
    cart: Pick<
      CartContextType,
      'isHydrated' | 'sharedCartEnabled' | 'completeOxygenPurchasedLines'
    > | null;
  }
): Promise<void> {
  try {
    if (context?.cart && !context.cart.isHydrated) return;
    const raw = sessionStorage.getItem(CHECKOUT_PENDING_ORDER_STORAGE_KEY);
    if (!raw) return;
    const parsed = oxygenOwnedPendingCheckoutSchema.safeParse(JSON.parse(raw));
    if (
      !parsed.success ||
      parsed.data.orderId !== orderId ||
      parsed.data.merchantId !== merchantId
    )
      return;
    const snapshot = readOxygenCheckoutSnapshot(orderId, merchantId);
    if (snapshot) {
      const cart = context?.cart;
      if (
        context &&
        cart?.isHydrated &&
        !cart.sharedCartEnabled &&
        cart.completeOxygenPurchasedLines
      )
        cart.completeOxygenPurchasedLines(context.merchantSlug, snapshot.lines);
      if (
        snapshot.checkoutForm !== null &&
        sessionStorage.getItem('checkout-form') === snapshot.checkoutForm
      )
        sessionStorage.removeItem('checkout-form');
      clearOxygenCheckoutSnapshot(orderId);
    }
    sessionStorage.removeItem(CHECKOUT_PENDING_ORDER_STORAGE_KEY);
    await clearCheckoutIdempotencyKey(parsed.data.checkoutFingerprint);
  } catch {
    // A missing or inaccessible local recovery record must not prevent navigation.
  }
}
