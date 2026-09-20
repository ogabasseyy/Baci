import {
  buildCheckoutFunnelProperties,
  CHECKOUT_FUNNEL_EVENTS,
  getCheckoutPaymentIntent,
} from '@baci/shared/contracts';
import { trackEvent } from './analytics-core';
import { serializeAfterOrderCreated } from './serialize-after-order-created';

export function trackCheckoutPaymentFailed(
  reason: string,
  orderId?: string,
  paymentMethod?: string
): Promise<void> {
  const emit = () => {
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
  };
  // Pre-order failures carry no order id, so there is no causal
  // predecessor to wait for: emit directly. Same-order failures chain
  // behind the order-created write like payment_started does, so an SDK
  // error racing the creation path cannot land before order_created or
  // the queued payment_started.
  if (!orderId) {
    emit();
    return Promise.resolve();
  }
  return serializeAfterOrderCreated(orderId, emit);
}
