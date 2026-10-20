import { expect, it } from 'vitest';
import { recordPaymentSchema } from './order-record-payment';

it('preserves record-payment validation', () => {
  expect(recordPaymentSchema.parse({ amount: '100' })).toEqual({
    amount: 100,
    payment_method: 'manual',
  });
  expect(recordPaymentSchema.safeParse({ amount: 0 }).success).toBe(false);
});
