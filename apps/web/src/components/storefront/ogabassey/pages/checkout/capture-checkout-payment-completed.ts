import {
  CHECKOUT_FUNNEL_EVENTS,
  buildCheckoutFunnelProperties,
  getCheckoutPaymentIntent,
} from '@baci/shared/contracts';
import { captureCheckoutFunnelEventOnce } from '@/lib/posthog/capture-checkout-funnel-event';

interface CheckoutPaymentCompleted {
  currency?: string;
  itemCount?: number;
  orderId: string;
  orderNumber?: string;
  paymentMethod: string;
  reference?: string;
  total?: number;
}

// Web checkout paid conversion, claimed once per order. Callers pass the
// authoritative attribution: the server-returned method after full
// coverage (not the UI selection), the reference that proved payment,
// and the canonical row total (not a wallet residual).
export function captureCheckoutPaymentCompleted({
  currency,
  itemCount,
  orderId,
  orderNumber,
  paymentMethod,
  reference,
  total,
}: CheckoutPaymentCompleted) {
  captureCheckoutFunnelEventOnce(
    CHECKOUT_FUNNEL_EVENTS.paymentCompleted,
    orderId,
    buildCheckoutFunnelProperties({
      channel: 'web',
      currency,
      itemCount,
      orderId,
      orderNumber,
      paymentIntent: getCheckoutPaymentIntent(paymentMethod),
      paymentMethod,
      paymentStatus: 'paid',
      reference,
      source: 'web_checkout',
      total,
    })
  );
}
