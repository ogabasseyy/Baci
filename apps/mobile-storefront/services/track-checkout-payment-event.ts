import {
  buildCheckoutFunnelProperties,
  getCheckoutPaymentIntent,
} from '@baci/shared/contracts';
import { trackEvent } from './analytics-core';

export function trackCheckoutPaymentEvent(
  event: string,
  input: {
    orderId: string;
    orderNumber?: string;
    paymentMethod: string;
    reference?: string;
    value?: number;
  },
  paymentStatus?: string
): void {
  trackEvent(
    event,
    buildCheckoutFunnelProperties({
      channel: 'mobile_app',
      orderId: input.orderId,
      orderNumber: input.orderNumber,
      paymentIntent: getCheckoutPaymentIntent(input.paymentMethod),
      paymentMethod: input.paymentMethod,
      paymentStatus,
      reference: input.reference,
      source: 'mobile_app',
      total: input.value,
    })
  );
}
