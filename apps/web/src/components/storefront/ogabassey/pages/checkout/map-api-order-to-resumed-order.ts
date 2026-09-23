import type { ResumedOrder } from './types';

/** Maps a storefront order API payload into checkout resume state. */
export function mapApiOrderToResumedOrder(
  orderData: Record<string, unknown>,
): ResumedOrder {
  const shippingAddress =
    orderData.shipping_address &&
    typeof orderData.shipping_address === 'object' &&
    !Array.isArray(orderData.shipping_address)
      ? (orderData.shipping_address as ResumedOrder['shipping_address'])
      : { address: '', city: '', state: '', phone: '' };

  return {
    id: String(orderData.id ?? ''),
    short_id: String(orderData.short_id ?? ''),
    subtotal: Number(orderData.subtotal) || 0,
    // Authenticated order detail selects `shipping_fee`; public tracking exposes `shipping_cost`.
    shipping_cost:
      Number(orderData.shipping_cost ?? orderData.shipping_fee) || 0,
    tax_amount: Number(orderData.tax_amount) || 0,
    discount_amount: Number(orderData.discount_amount) || 0,
    gift_wrapping_fee: Number(orderData.gift_wrapping_fee) || 0,
    total: Number(orderData.total) || 0,
    customer_name: String(orderData.customer_name ?? ''),
    customer_email: String(orderData.customer_email ?? ''),
    customer_phone: String(orderData.customer_phone ?? ''),
    tracking_token:
      typeof orderData.tracking_token === 'string'
        ? orderData.tracking_token
        : undefined,
    shipping_address: {
      address: shippingAddress.address || '',
      city: shippingAddress.city || '',
      state: shippingAddress.state || '',
      phone: shippingAddress.phone || '',
    },
    items: Array.isArray(orderData.items)
      ? (orderData.items as ResumedOrder['items'])
      : [],
  };
}
