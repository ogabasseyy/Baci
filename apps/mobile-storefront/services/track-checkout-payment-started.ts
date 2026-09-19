import { CHECKOUT_FUNNEL_EVENTS } from '@baci/shared/contracts';
import { trackCheckoutPaymentEvent } from './track-checkout-payment-event';

export function trackCheckoutPaymentStarted(input: {
  orderId: string;
  orderNumber?: string;
  paymentMethod: string;
  value?: number;
}): void {
  trackCheckoutPaymentEvent(CHECKOUT_FUNNEL_EVENTS.paymentStarted, input);
}
