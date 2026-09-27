import {
  buildCheckoutFunnelProperties,
  CHECKOUT_FUNNEL_EVENTS,
} from '@baci/shared/contracts';
import { trackEvent } from './analytics-core';

export function trackCheckoutInvoiceGenerated(order: {
  orderId: string;
  orderNumber: string;
  total: number;
  itemCount: number;
  paymentMethod?: string;
  currency?: string;
}): void {
  trackEvent(
    CHECKOUT_FUNNEL_EVENTS.invoiceGenerated,
    buildCheckoutFunnelProperties({
      channel: 'mobile_app',
      currency: order.currency,
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
