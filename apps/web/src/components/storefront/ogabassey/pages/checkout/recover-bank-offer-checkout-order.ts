import type {
  PendingCheckoutOrderSnapshot,
  ResolvePendingCheckoutOrderResult,
} from './pending-checkout-order';
import type { fetchFencedOrderState } from './pending-checkout-redvault-fence';

export function recoverBankOfferCheckoutOrder(
  existingOrder: NonNullable<Awaited<ReturnType<typeof fetchFencedOrderState>>>,
  pendingOrder: PendingCheckoutOrderSnapshot
): ResolvePendingCheckoutOrderResult | null {
  if (existingOrder.payment_method !== 'bank_card_offer') return null;
  const total = Number(existingOrder.total);
  if (
    existingOrder.id !== pendingOrder.orderId ||
    existingOrder.currency !== 'NGN' ||
    !Number.isFinite(total) ||
    total <= 0
  ) {
    throw new Error('Unable to recover the pending bank card offer order');
  }

  // The original shipping and quote are immutable. Forward the verified order
  // to Paystack initialization without sending it through ordinary order reuse.
  return {
    reusableOrder: {
      order: {
        id: existingOrder.id,
        order_number: existingOrder.order_number,
        tracking_token: pendingOrder.trackingToken,
        currency: existingOrder.currency,
        payment_method: existingOrder.payment_method,
        total,
      },
      amountDueToGateway: total,
    },
    clearStoredOrder: false,
  };
}
