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
      itemCount: checkout.itemCount,
      source: 'mobile_app',
      subtotal: checkout.subtotal,
      total: checkout.subtotal,
    })
  );
}
