import { CHECKOUT_FUNNEL_EVENTS } from '@baci/shared/contracts';
import { serializeAfterOrderCreated } from './serialize-after-order-created';
import { trackCheckoutPaymentEvent } from './track-checkout-payment-event';

export async function trackCheckoutPaymentStarted(input: {
  orderId: string;
  orderNumber?: string;
  paymentMethod: string;
  reference?: string;
  value?: number;
  currency?: string;
}): Promise<void> {
  // Chain behind the order-created emission for this order so the funnel
  // keeps causal order even though creation is recorded fire-and-forget.
  return await serializeAfterOrderCreated(input.orderId, () => {
    trackCheckoutPaymentEvent(CHECKOUT_FUNNEL_EVENTS.paymentStarted, input);
  });
}
