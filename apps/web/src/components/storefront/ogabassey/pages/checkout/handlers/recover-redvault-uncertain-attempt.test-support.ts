export const merchantId = '11111111-1111-4111-8111-111111111111';
export const cartId = '22222222-2222-4222-8222-222222222222';
export const sessionId = '44444444-4444-4444-8444-444444444444';
const fingerprint = `uba_redvault:${JSON.stringify({
  merchantId,
  customerEmail: 'ada@example.com',
  items: [{ id: 'phone' }],
})}`;
export const orderRequest = {
  merchant_id: merchantId,
  customer_email: 'ada@example.com',
  customer_name: 'Ada Customer',
  customer_phone: '08000000000',
  items: [{ product_id: 'phone', name: 'Phone', quantity: 1, price: 100 }],
  subtotal: 100,
  payment_method: 'uba_redvault',
  shared_cart: {
    cart_id: cartId,
    cart_version: 1,
    checkout_generation: 1,
    checkout_session_id: sessionId,
  },
};
export const attempt = {
  merchantId,
  idempotencyKey: 'attempt-key',
  fingerprint,
  customer: {
    email: 'ada@example.com',
    name: 'Ada Customer',
    phone: '08000000000',
  },
  billingAddress: {
    line1: 'Store pickup',
    city: 'Lagos',
    state: 'Lagos',
    country: 'NG',
  },
  orderRequest: orderRequest as never,
};
export const response = {
  order: {
    id: 'order-1',
    total: 102.5,
    currency: 'NGN',
    tracking_token: 'tracking-token',
  },
  redvault: {
    quote: {
      product_subtotal_kobo: 10000,
      eligible_subtotal_kobo: 10000,
      ineligible_subtotal_kobo: 0,
      discount_kobo: 500,
      assurance_fee_kobo: 0,
      tax_kobo: 750,
      shipping_kobo: 0,
      gift_wrapping_kobo: 0,
      payable_kobo: 10250,
      mixed_basket: false,
    },
  },
};
