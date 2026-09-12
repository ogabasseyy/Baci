export const redvaultOrderResponse = {
  order: {
    id: '44444444-4444-4444-8444-444444444444',
    total: 117.5,
    currency: 'NGN',
    tracking_token: null,
    payment_method: 'uba_redvault',
    payment_status: 'unpaid',
  },
  redvault: {
    status: 'pending',
    quote: {
      product_subtotal_kobo: 11000,
      eligible_subtotal_kobo: 10000,
      ineligible_subtotal_kobo: 1000,
      discount_kobo: 500,
      tax_kobo: 750,
      shipping_kobo: 500,
      gift_wrapping_kobo: 0,
      payable_kobo: 11750,
      mixed_basket: true,
    },
  },
};

export const redvaultOrderRequest = {
  customer_email: 'ada@example.com',
  customer_name: 'Ada Customer',
  customer_phone: '08012345678',
  items: [{ id: 'product-1', name: 'Phone', quantity: 1, price: 999 }],
  subtotal: 999,
  shipping_fee: 99,
  payment_method: 'uba_redvault',
  source: 'mobile_app',
  shipping_address: {
    firstName: 'Ada',
    lastName: 'Customer',
    address: '1 Road',
    city: 'Ikeja',
    state: 'Lagos',
  },
};
