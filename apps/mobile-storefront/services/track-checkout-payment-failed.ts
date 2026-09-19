import {
  buildCheckoutFunnelProperties,
  CHECKOUT_FUNNEL_EVENTS,
  getCheckoutPaymentIntent,
} from '@baci/shared/contracts';
import { trackEvent } from './analytics-core';

export function trackCheckoutPaymentFailed(
  reason: string,
  orderId?: string,
  paymentMethod?: string
): void {
  trackEvent(
    CHECKOUT_FUNNEL_EVENTS.paymentFailed,
    buildCheckoutFunnelProperties({
      channel: 'mobile_app',
      orderId,
      paymentIntent: paymentMethod
        ? getCheckoutPaymentIntent(paymentMethod)
        : undefined,
      paymentMethod,
      reason,
      source: 'mobile_app',
    })
  );
}
