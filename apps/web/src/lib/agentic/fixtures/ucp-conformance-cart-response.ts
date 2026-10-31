import { buildUcpCartResponse } from '@/lib/agentic/ucp-cart-response';
import { LINE_MINOR } from './ucp-conformance-data';

export function cartResponse() {
  return buildUcpCartResponse({
    cartId: 'cart_1',
    continueUrl: 'https://ogabassey.com/ogabassey/cart#handoff=example',
    currency: 'NGN',
    lineItems: [
      {
        base_amount: LINE_MINOR,
        discount: 0,
        id: 'line_1',
        item: {
          id: 'variant-1',
          product_id: 'product-1',
          quantity: 2,
          title: 'Kobo phone',
        },
        subtotal: LINE_MINOR,
        tax: 0,
        total: LINE_MINOR,
      },
    ],
    status: 'active',
    totals: [
      { amount: LINE_MINOR, display_text: 'Subtotal', type: 'subtotal' },
      { amount: LINE_MINOR, display_text: 'Total', type: 'total' },
    ],
  });
}
