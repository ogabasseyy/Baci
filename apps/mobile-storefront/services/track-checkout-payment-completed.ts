import { CHECKOUT_FUNNEL_EVENTS } from '@baci/shared/contracts';
import { trackCheckoutPaymentEvent } from './track-checkout-payment-event';

export function trackCheckoutPaymentCompleted(input: {
  orderId: string;
  orderNumber?: string;
  paymentMethod: string;
  reference?: string;
  value?: number;
}): void {
  trackCheckoutPaymentEvent(
    CHECKOUT_FUNNEL_EVENTS.paymentCompleted,
    input,
    'paid'
  );
}
