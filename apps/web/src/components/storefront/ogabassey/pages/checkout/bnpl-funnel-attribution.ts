import {
  CHECKOUT_FUNNEL_EVENTS,
  buildCheckoutFunnelProperties,
} from '@baci/shared/contracts';
import { captureCheckoutFunnelEventOnce } from '@/lib/posthog/capture-checkout-funnel-event';
import { captureClientEvent } from '@/lib/posthog/capture-client-event';

export function isNativeBnplWebView(): boolean {
  return (
    typeof window !== 'undefined' && Boolean(window.ReactNativeWebView)
  );
}

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

interface BnplPaymentStarted {
  orderId: string;
  orderNumber?: string;
  paymentMethod: string;
  value?: number;
  currency?: string;
}

export function captureBnplPaymentStarted({
  orderId,
  orderNumber,
  paymentMethod,
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
      source: 'web_checkout',
      total: value,
    })
  );
}

interface BnplPaymentFailed {
  orderId: string;
  orderNumber?: string;
  paymentMethod: string;
  reason: string;
  value?: number;
  currency?: string;
}

export function captureBnplPaymentFailed({
  orderId,
  orderNumber,
  paymentMethod,
  reason,
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
      source: 'web_checkout',
      total: value,
    })
  );
}
