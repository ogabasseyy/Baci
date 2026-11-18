import { expect, it } from 'vitest';
import { merchantOrderCancellationSchema } from './merchant-order-cancellation';

it('preserves merchant-order-cancellation validation', () => {
  expect(merchantOrderCancellationSchema.safeParse({}).success).toBe(false);
  expect(
    merchantOrderCancellationSchema.parse({ confirm_cancellation: true })
  ).toEqual({ confirm_cancellation: true, refund: 'automatic' });
});

it('accepts a cancel-only refund choice and rejects unknown ones', () => {
  expect(
    merchantOrderCancellationSchema.parse({
      confirm_cancellation: true,
      refund: 'manual',
    }).refund
  ).toBe('manual');
  expect(
    merchantOrderCancellationSchema.safeParse({
      confirm_cancellation: true,
      refund: 'none',
    }).success
  ).toBe(false);
});
