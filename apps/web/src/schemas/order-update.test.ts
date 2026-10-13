import { expect, it } from 'vitest';
import { orderUpdateSchema } from './order-update';

it('preserves order-update validation', () => {
  expect(orderUpdateSchema.parse({ shipping_status: 'shipped' })).toEqual({
    shipping_status: 'shipped',
  });
  expect(orderUpdateSchema.safeParse({ admin: true }).success).toBe(false);
});
