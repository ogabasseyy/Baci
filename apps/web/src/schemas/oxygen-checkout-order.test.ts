import { expect, it } from 'vitest';
import { oxygenCheckoutOrderSchema } from './oxygen-checkout-order';

const order = {
  id: '60000000-0000-4000-8000-000000000001',
  customer_name: null,
  customer_email: null,
  currency: 'NGN',
  subtotal: '100.50',
  shipping_fee: 0,
  tax_amount: '1',
  total: '101.5',
  order_items: [
    {
      id: '60000000-0000-4000-8000-000000000002',
      name: 'Item',
      quantity: 1,
      price: '100.50',
    },
  ],
};
it('parses monetary database strings into finite amounts', () => {
  expect(oxygenCheckoutOrderSchema.parse(order)).toMatchObject({
    subtotal: 100.5,
    total: 101.5,
    order_items: [{ price: 100.5 }],
  });
});
it('rejects negative, empty and non-finite prices, invalid currency and quantities', () => {
  for (const total of [' ', '-1', 'Infinity', 'invalid'])
    expect(
      oxygenCheckoutOrderSchema.safeParse({ ...order, total }).success
    ).toBe(false);
  expect(
    oxygenCheckoutOrderSchema.safeParse({ ...order, currency: 'ngn' }).success
  ).toBe(false);
  expect(
    oxygenCheckoutOrderSchema.safeParse({
      ...order,
      order_items: [{ ...order.order_items[0], quantity: 0 }],
    }).success
  ).toBe(false);
});
