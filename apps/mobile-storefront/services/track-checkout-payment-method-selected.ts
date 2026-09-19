import {
  buildCheckoutFunnelProperties,
  CHECKOUT_FUNNEL_EVENTS,
  getCheckoutPaymentIntent,
} from '@baci/shared/contracts';
import { trackEvent } from './analytics-core';

export function trackCheckoutPaymentMethodSelected(
  paymentMethod: string
): void {
  trackEvent(
    CHECKOUT_FUNNEL_EVENTS.paymentMethodSelected,
    buildCheckoutFunnelProperties({
      channel: 'mobile_app',
      paymentIntent: getCheckoutPaymentIntent(paymentMethod),
      paymentMethod,
      source: 'mobile_app',
    })
  );
}
