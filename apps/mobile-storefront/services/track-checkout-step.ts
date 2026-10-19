import {
  type AnalyticsProperties,
  buildCheckoutFunnelProperties,
  buildCheckoutStepCompletedProperties,
  CHECKOUT_FUNNEL_EVENTS,
  type CheckoutStepName,
  ECOMMERCE_ANALYTICS_EVENTS,
} from '@baci/shared/contracts';
import { trackEvent } from './analytics-core';

export function trackCheckoutStep(
  step: CheckoutStepName,
  properties?: AnalyticsProperties,
  currency?: string
): void {
  trackEvent(
    ECOMMERCE_ANALYTICS_EVENTS.checkoutStepCompleted,
    buildCheckoutStepCompletedProperties(step, properties)
  );
  trackEvent(
    CHECKOUT_FUNNEL_EVENTS.checkoutStepCompleted,
    buildCheckoutFunnelProperties({
      channel: 'mobile_app',
      checkoutStep: step,
      currency,
      properties,
      source: 'mobile_app',
    })
  );
}
