import { buildCheckoutIdempotencyPayload } from './build-checkout-idempotency-payload';

it('normalizes email casing and delivery whitespace like the server hash', () => {
  const base = {
    customer_email: 'Buyer@Example.com',
    customer_name: 'Ada Okafor',
    customer_phone: '08012345678',
    items: [{ product_id: 'buds2', price: 85000, quantity: 1 }],
    merchant_id: 'merchant-one',
    shipping_address: {
      address: '15  Marina   Road',
      city: 'Lagos',
      state: 'Lagos',
    },
    shipping_fee: 7692,
  };

  expect(buildCheckoutIdempotencyPayload(base)).toEqual(
    buildCheckoutIdempotencyPayload({
      ...base,
      customer_email: 'buyer@example.com',
      shipping_address: {
        address: '15 Marina Road',
        city: 'Lagos',
        state: 'Lagos',
      },
    })
  );
});
