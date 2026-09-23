import {
  buildCheckoutFunnelProperties,
  buildCheckoutStartedProperties,
  CHECKOUT_FUNNEL_EVENTS,
  ECOMMERCE_ANALYTICS_EVENTS,
} from '@baci/shared/contracts';
import { trackEvent } from './analytics-core';

export function trackCheckoutStarted(checkout: {
  cartId?: string;
  itemCount: number;
  subtotal: number;
  currency?: string;
}): void {
  trackEvent(
    ECOMMERCE_ANALYTICS_EVENTS.checkoutStarted,
    buildCheckoutStartedProperties(checkout)
  );
  trackEvent(
    CHECKOUT_FUNNEL_EVENTS.checkoutStarted,
    buildCheckoutFunnelProperties({
      channel: 'mobile_app',
      // The legacy event above already receives the checkout currency:
      // the canonical event must carry it too, or every non-NGN mobile
      // start defaults to NGN and splits from its stamped downstream
      // events.
      currency: checkout.currency,
      itemCount: checkout.itemCount,
      source: 'mobile_app',
      subtotal: checkout.subtotal,
      total: checkout.subtotal,
    })
  );
}
