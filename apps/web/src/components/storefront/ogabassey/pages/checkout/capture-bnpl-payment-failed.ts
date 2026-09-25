import {
  CHECKOUT_FUNNEL_EVENTS,
  buildCheckoutFunnelProperties,
} from '@baci/shared/contracts';
import { captureClientEvent } from '@/lib/posthog/capture-client-event';
import { isNativeBnplWebView } from './is-native-bnpl-web-view';

interface BnplPaymentFailed {
  orderId: string;
  orderNumber?: string;
  paymentMethod: string;
  reason: string;
  reference?: string;
  value?: number;
  currency?: string;
}

export function captureBnplPaymentFailed({
  orderId,
  orderNumber,
  paymentMethod,
  reason,
  reference,
  value,
  currency,
}: BnplPaymentFailed) {
  // Inside a native BNPL WebView the native shell records the failure
  // from bnpl_provider_error: emitting here would double-attribute.
  if (isNativeBnplWebView()) {
    return;
  }
  captureClientEvent(
    CHECKOUT_FUNNEL_EVENTS.paymentFailed,
    buildCheckoutFunnelProperties({
      channel: 'web',
      ...(currency ? { currency } : {}),
      orderId,
      orderNumber,
      paymentIntent: 'installments',
      paymentMethod,
      reason,
      reference,
      source: 'web_checkout',
      total: value,
    })
  );
}
