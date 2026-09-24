import {
  CHECKOUT_FUNNEL_EVENTS,
  buildCheckoutFunnelProperties,
  getCheckoutPaymentIntent,
} from '@baci/shared/contracts';
import { captureClientEvent } from '@/lib/posthog/capture-client-event';

interface CheckoutPaymentStarted {
  currency?: string;
  orderId: string;
  orderNumber?: string;
  paymentMethod: string;
  reference?: string;
  total?: number;
}

// Web checkout payment start: emitted only once a provider flow actually
// opens (initialized DVA, provider URL, opened widget, confirmed transfer
// setup) — never speculatively before initialization runs. Stamped with
// the initialized reference where one exists so retried attempts
// reconcile instead of producing identical starts.
export function captureCheckoutPaymentStarted({
  currency,
  orderId,
  orderNumber,
  paymentMethod,
  reference,
  total,
}: CheckoutPaymentStarted) {
  captureClientEvent(
    CHECKOUT_FUNNEL_EVENTS.paymentStarted,
    buildCheckoutFunnelProperties({
      channel: 'web',
      currency,
      orderId,
      orderNumber,
      paymentIntent: getCheckoutPaymentIntent(paymentMethod),
      paymentMethod,
      reference,
      source: 'web_checkout',
      total,
    })
  );
}
