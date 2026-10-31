import { MAJOR_PRICE } from './ucp-conformance-data';

export function orderBody(shippingStatus: string) {
  return {
    checkout_id: 'agentic_session_1',
    currency: 'NGN',
    discount_amount: 0,
    id: 'order-1',
    links: { track_order: 'https://ogabassey.com/track-order' },
    order_items: [
      {
        id: 'order-item-1',
        line_extension_amount: 79.96,
        name: 'Kobo phone',
        price: MAJOR_PRICE,
        product_id: 'product-1',
        quantity: 2,
        variant_id: 'variant-1',
      },
    ],
    shipping_fee: 0,
    shipping_status: shippingStatus,
    subtotal: 79.96,
    tax_amount: 0,
    total: 79.96,
    updated_at: '2026-10-31T09:00:00.000Z',
  };
}
