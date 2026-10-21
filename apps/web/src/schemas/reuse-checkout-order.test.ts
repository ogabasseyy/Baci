import { expect, it } from 'vitest';
import { reuseCheckoutOrderSchema } from './reuse-checkout-order';

const id = '123e4567-e89b-12d3-a456-426614174000';

it('preserves reuse-checkout-order validation', () => {
  expect(
    reuseCheckoutOrderSchema.parse({
      order_id: id,
      merchant_id: id,
      tracking_token: 'token',
      customer_email: 'test@example.com',
      payment_method: 'card',
      selected_quote_id: null,
    }).selected_quote_id
  ).toBeNull();
});
