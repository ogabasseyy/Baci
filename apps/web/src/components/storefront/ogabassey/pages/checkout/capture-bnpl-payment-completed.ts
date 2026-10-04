import {
  CHECKOUT_FUNNEL_EVENTS,
  buildCheckoutFunnelProperties,
} from '@baci/shared/contracts';
import { captureCheckoutFunnelEventOnce } from '@/lib/posthog/capture-checkout-funnel-event';
import { isNativeBnplWebView } from './is-native-bnpl-web-view';

interface BnplPaymentCompleted {
  orderId: string;
  orderNumber?: string;
  paymentMethod: string;
  reference?: string;
  value?: number;
  currency?: string;
}

export function captureBnplPaymentCompleted({
  orderId,
  orderNumber,
  paymentMethod,
  reference,
  value,
  currency,
}: BnplPaymentCompleted) {
  // Inside a native BNPL WebView the native shell owns conversion
  // attribution (with native-verified outcomes): emitting here would
  // double-attribute every web completion event.
  if (isNativeBnplWebView()) {
    return;
  }
  captureCheckoutFunnelEventOnce(
    CHECKOUT_FUNNEL_EVENTS.paymentCompleted,
    orderId,
    buildCheckoutFunnelProperties({
      channel: 'web',
      ...(currency ? { currency } : {}),
      orderId,
      orderNumber,
      paymentIntent:
        paymentMethod === 'credpal' ||
        paymentMethod === 'credit_direct' ||
        paymentMethod === 'klump'
          ? 'installments'
          : undefined,
      paymentMethod,
      paymentStatus: 'paid',
      reference,
      source: 'web_checkout',
      total: value,
    })
  );
}
