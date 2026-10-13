import { expect, it } from 'vitest';
import { merchantOrderCancellationSchema } from './merchant-order-cancellation';

it('preserves merchant-order-cancellation validation', () => {
  expect(merchantOrderCancellationSchema.safeParse({}).success).toBe(false);
  expect(
    merchantOrderCancellationSchema.parse({ confirm_cancellation: true })
  ).toEqual({ confirm_cancellation: true });
});
