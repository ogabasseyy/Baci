import { expect, it } from 'vitest';
import {
  buildOrderIdempotencyPayload,
  hashOrderIdempotencyPayload,
} from './order-idempotency';

const baseOrder = {
  merchant_id: '11111111-1111-1111-1111-111111111111',
  customer_email: 'test@example.com',
  customer_name: 'Test Buyer',
  items: [{ quantity: 1, price: 1000 }],
  shipping_address: {
    address: '12 Test Street',
    city: 'Ikeja',
    state: 'Lagos',
  },
};

it('conflicts when only a quote-less checkout destination pin changes', () => {
  const original = {
    ...baseOrder,
    selected_quote_id: null,
    shipping_address: {
      ...baseOrder.shipping_address,
      latitude: 6.5,
      longitude: 3.35,
    },
  };
  const changed = {
    ...original,
    shipping_address: { ...original.shipping_address, latitude: 6.6 },
  };
  expect(
    hashOrderIdempotencyPayload(buildOrderIdempotencyPayload(original))
  ).not.toBe(
    hashOrderIdempotencyPayload(buildOrderIdempotencyPayload(changed))
  );
});
