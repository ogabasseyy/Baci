import {
  CHECKOUT_FUNNEL_EVENTS,
  buildCheckoutFunnelProperties,
} from '@baci/shared/contracts';
import { captureClientEvent } from '@/lib/posthog/capture-client-event';
import { isNativeBnplWebView } from './is-native-bnpl-web-view';

interface BnplPaymentStarted {
  orderId: string;
  orderNumber?: string;
  paymentMethod: string;
  reference?: string;
  value?: number;
  currency?: string;
}

export function captureBnplPaymentStarted({
  orderId,
  orderNumber,
  paymentMethod,
  reference,
  value,
  currency,
}: BnplPaymentStarted) {
  // Inside a native BNPL WebView the native shell records the start from
  // bnpl_provider_opened: emitting here would double-attribute every
  // web start event.
  if (isNativeBnplWebView()) {
    return;
  }
  captureClientEvent(
    CHECKOUT_FUNNEL_EVENTS.paymentStarted,
    buildCheckoutFunnelProperties({
      channel: 'web',
      ...(currency ? { currency } : {}),
      orderId,
      orderNumber,
      paymentIntent: 'installments',
      paymentMethod,
      reference,
      source: 'web_checkout',
      total: value,
    })
  );
}
