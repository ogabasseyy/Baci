import {
  CHECKOUT_FUNNEL_EVENTS,
  buildCheckoutFunnelProperties,
} from '@baci/shared/contracts';
import { captureCheckoutFunnelEventOnce } from '@/lib/posthog/capture-checkout-funnel-event';

interface CheckoutInvoiceGenerated {
  currency?: string;
  itemCount: number;
  orderId: string;
  orderNumber?: string;
  total?: number;
}

// Web proforma generation, claimed once per order: the server generates
// and emails a proforma for invoice-method orders, so the funnel records
// the generation instead of showing a false drop-off.
export function captureCheckoutInvoiceGenerated({
  currency,
  itemCount,
  orderId,
  orderNumber,
  total,
}: CheckoutInvoiceGenerated) {
  captureCheckoutFunnelEventOnce(
    CHECKOUT_FUNNEL_EVENTS.invoiceGenerated,
    orderId,
    buildCheckoutFunnelProperties({
      channel: 'web',
      currency,
      itemCount,
      orderId,
      orderNumber,
      paymentIntent: 'proforma_invoice',
      paymentMethod: 'invoice',
      paymentStatus: 'unpaid',
      source: 'web_checkout',
      total,
    })
  );
}
