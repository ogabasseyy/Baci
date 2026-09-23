import {
  buildCheckoutFunnelProperties,
  CHECKOUT_FUNNEL_EVENTS,
  getCheckoutPaymentIntent,
} from '@baci/shared/contracts';
import { trackEvent } from './analytics-core';

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
  /**
   * Checkout currency: absent values keep the builder default so
   * callers without a currency source render exactly as before.
   */
  currency?: string;
}): void {
  trackEvent(
    CHECKOUT_FUNNEL_EVENTS.orderCreated,
    buildCheckoutFunnelProperties({
      channel: 'mobile_app',
      currency: order.currency,
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
