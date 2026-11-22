import { expect, it } from 'vitest';
import { checkoutOrderNotReusable } from './checkout-order-not-reusable';

it('tells checkout to start a new order when the saved order cannot be reused', async () => {
  const response = checkoutOrderNotReusable();

  expect(response.status).toBe(409);
  await expect(response.json()).resolves.toMatchObject({
    code: 'CHECKOUT_ORDER_NOT_REUSABLE',
    error: expect.stringContaining('start a new order'),
  });
});
