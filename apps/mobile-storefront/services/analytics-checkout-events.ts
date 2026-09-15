import {
  type AnalyticsProperties,
  buildCheckoutFunnelProperties,
  buildCheckoutStartedProperties,
  buildCheckoutStepCompletedProperties,
  CHECKOUT_FUNNEL_EVENTS,
  type CheckoutStepName,
  ECOMMERCE_ANALYTICS_EVENTS,
  getCheckoutPaymentIntent,
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

export function trackCheckoutStep(
  step: CheckoutStepName,
  properties?: AnalyticsProperties
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
      properties,
      source: 'mobile_app',
    })
  );
}

export function trackCheckoutPaymentMethodSelected(
  paymentMethod: string
): void {
  trackEvent(
    CHECKOUT_FUNNEL_EVENTS.paymentMethodSelected,
    buildCheckoutFunnelProperties({
      channel: 'mobile_app',
      paymentIntent: getCheckoutPaymentIntent(paymentMethod),
      paymentMethod,
      source: 'mobile_app',
    })
  );
}

export function trackCheckoutOrderCreated(order: {
  orderId: string;
  orderNumber: string;
  total: number;
  itemCount: number;
  paymentMethod: string;
  paymentStatus?: string;
  durationMs?: number;
  subtotal?: number;
  shipping?: number;
  tax?: number;
}): void {
  trackEvent(
    CHECKOUT_FUNNEL_EVENTS.orderCreated,
    buildCheckoutFunnelProperties({
      channel: 'mobile_app',
      durationMs: order.durationMs,
      itemCount: order.itemCount,
      orderId: order.orderId,
      orderNumber: order.orderNumber,
      paymentIntent: getCheckoutPaymentIntent(order.paymentMethod),
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      shipping: order.shipping,
      source: 'mobile_app',
      subtotal: order.subtotal,
      tax: order.tax,
      total: order.total,
    })
  );
}

export function trackCheckoutInvoiceGenerated(order: {
  orderId: string;
  orderNumber: string;
  total: number;
  itemCount: number;
  paymentMethod?: string;
}): void {
  trackEvent(
    CHECKOUT_FUNNEL_EVENTS.invoiceGenerated,
    buildCheckoutFunnelProperties({
      channel: 'mobile_app',
      itemCount: order.itemCount,
      orderId: order.orderId,
      orderNumber: order.orderNumber,
      paymentIntent: 'proforma_invoice',
      paymentMethod: order.paymentMethod || 'invoice',
      paymentStatus: 'unpaid',
      source: 'mobile_app',
      total: order.total,
    })
  );
}

function trackCheckoutPaymentEvent(
  event: string,
  input: {
    orderId: string;
    orderNumber?: string;
    paymentMethod: string;
    reference?: string;
    value?: number;
  },
  paymentStatus?: string
): void {
  trackEvent(
    event,
    buildCheckoutFunnelProperties({
      channel: 'mobile_app',
      orderId: input.orderId,
      orderNumber: input.orderNumber,
      paymentIntent: getCheckoutPaymentIntent(input.paymentMethod),
      paymentMethod: input.paymentMethod,
      paymentStatus,
      reference: input.reference,
      source: 'mobile_app',
      total: input.value,
    })
  );
}

export function trackCheckoutPaymentStarted(input: {
  orderId: string;
  orderNumber?: string;
  paymentMethod: string;
  value?: number;
}): void {
  trackCheckoutPaymentEvent(CHECKOUT_FUNNEL_EVENTS.paymentStarted, input);
}

export function trackCheckoutPaymentCompleted(input: {
  orderId: string;
  orderNumber?: string;
  paymentMethod: string;
  reference?: string;
  value?: number;
}): void {
  trackCheckoutPaymentEvent(
    CHECKOUT_FUNNEL_EVENTS.paymentCompleted,
    input,
    'paid'
  );
}

export function trackCheckoutPaymentFailed(
  reason: string,
  orderId?: string,
  paymentMethod?: string
): void {
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
}
