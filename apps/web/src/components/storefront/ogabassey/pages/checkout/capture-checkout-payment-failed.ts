import {
  CHECKOUT_FUNNEL_EVENTS,
  buildCheckoutFunnelProperties,
  getCheckoutPaymentIntent,
} from '@baci/shared/contracts';
import { captureClientEvent } from '@/lib/posthog/capture-client-event';

interface CheckoutPaymentFailed {
  currency?: string;
  orderId: string;
  orderNumber?: string;
  paymentMethod: string;
  reason: string;
  reference?: string;
  total?: number;
}

// Web checkout payment failure. Callers gate on the per-attempt
// started flag: initialization failures before a provider flow opens
// keep the error UI but must not emit an unmatched payment_failed.
export function captureCheckoutPaymentFailed({
  currency,
  orderId,
  orderNumber,
  paymentMethod,
  reason,
  reference,
  total,
}: CheckoutPaymentFailed) {
  captureClientEvent(
    CHECKOUT_FUNNEL_EVENTS.paymentFailed,
    buildCheckoutFunnelProperties({
      channel: 'web',
      currency,
      orderId,
      orderNumber,
      paymentIntent: getCheckoutPaymentIntent(paymentMethod),
      paymentMethod,
      reason,
      reference,
      source: 'web_checkout',
      total,
    })
  );
}
