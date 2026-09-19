import { claimCheckoutPurchaseTracking } from '@/lib/claim-checkout-purchase-tracking';
import { useCartStore } from '@/stores/cart-store';
import { trackCheckoutRoutePurchaseCompleted } from './tiktok-checkout-route-tracking';
import { trackCheckoutPaymentCompleted } from './track-checkout-payment-completed';

type CheckoutPaymentCompletionInput = {
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
    items: useCartStore.getState().items,
    orderId: input.orderId,
    orderNumber: input.orderNumber || input.orderId,
    paymentMethod: input.paymentMethod,
    shipping: 0,
    subtotal: total,
    tax: 0,
    total,
  });
  return true;
}
