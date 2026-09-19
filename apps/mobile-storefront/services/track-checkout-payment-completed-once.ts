import { claimCheckoutPurchaseTracking } from '@/lib/claim-checkout-purchase-tracking';
import { type CartItem, useCartStore } from '@/stores/cart-store';
import { serializeAfterOrderCreated } from './serialize-after-order-created';
import { trackCheckoutRoutePurchaseCompleted } from './tiktok-checkout-route-tracking';
import { trackCheckoutPaymentCompleted } from './track-checkout-payment-completed';

export interface CheckoutCompletionAttribution {
  // Checkout identity snapshot for guest purchase matching (the cached
  // auth identity is empty for guests, so the server conversion would
  // otherwise receive blank email/phone/external id).
  customerEmail?: string;
  customerPhone?: string;
  userId?: string;
  // Snapshot callers whose cart may clear before the deferred completion
  // runs pass items synchronously so the purchase keeps its lines.
  items?: CartItem[];
  // Canonical order breakdown. Callers that know only the grand total omit
  // these and the purchase keeps total with zero shipping/tax; callers with
  // the snapshot/track-order breakdown must pass it so analytics dimensions
  // are not corrupted.
  subtotal?: number;
  shipping?: number;
  tax?: number;
}

type CheckoutPaymentCompletionInput = CheckoutCompletionAttribution & {
  orderId: string;
  orderNumber?: string;
  paymentMethod: string;
  reference?: string;
  value?: number;
};

const PAYMENT_COMPLETED_CLAIM_EVENT = 'payment_completed';

// Records the paid conversion once per order. The first caller wins the
// durable claim and emits both the funnel payment_completed event and the
// native ad purchase; replays after a remount, recovery, or reopened intent
// return false and emit nothing, while navigation still proceeds.
export async function trackCheckoutPaymentCompletedOnce(
  input: CheckoutPaymentCompletionInput
): Promise<boolean> {
  // Wait behind the order-created emission for this order so the funnel
  // keeps causal order even though creation is recorded fire-and-forget.
  return await serializeAfterOrderCreated(input.orderId, async () => {
    const claimed = await claimCheckoutPurchaseTracking(
      input.orderId,
      PAYMENT_COMPLETED_CLAIM_EVENT
    );
    if (!claimed) {
      return false;
    }
    const total = input.value ?? 0;
    trackCheckoutPaymentCompleted(input);
    trackCheckoutRoutePurchaseCompleted({
      customerEmail: input.customerEmail,
      customerPhone: input.customerPhone,
      items: input.items ?? useCartStore.getState().items,
      orderId: input.orderId,
      orderNumber: input.orderNumber || input.orderId,
      paymentMethod: input.paymentMethod,
      shipping: input.shipping ?? 0,
      subtotal: input.subtotal ?? total,
      tax: input.tax ?? 0,
      total,
      userId: input.userId,
    });
    return true;
  });
}
