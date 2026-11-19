import { describe, expect, it } from 'vitest';
import { oxygenFollowUpOrderSchema } from './oxygen-follow-up-order';

const order = {
  id: '20000000-0000-4000-8000-000000000001',
  order_number: null,
  customer_id: null,
  customer_name: null,
  customer_email: null,
  customer_phone: null,
  total: null,
  currency: 'NGN',
  payment_status: null,
  payment_method: null,
  created_at: '2026-11-17T09:00:00Z',
  cancelled_at: null,
};

describe('oxygenFollowUpOrderSchema', () => {
  it('accepts nullable details and numeric or string amounts for later eligibility classification', () => {
    expect(oxygenFollowUpOrderSchema.parse(order)).toEqual(order);
    for (const total of [null, 0, -1, '12000.50', 10000]) {
      expect(
        oxygenFollowUpOrderSchema.safeParse({ ...order, total }).success
      ).toBe(true);
    }
    for (const currency of ['NGN', 'USD', '', null]) {
      expect(
        oxygenFollowUpOrderSchema.safeParse({ ...order, currency }).success
      ).toBe(true);
    }
  });
  it.each([
    { id: 'bad-id' },
    { customer_id: 'bad-id' },
    { total: {} },
    { created_at: 'yesterday' },
    { cancelled_at: 'yesterday' },
    { provider_data: 'private' },
    { currency: 123 },
  ])('rejects malformed or private fields: %j', (fields) => {
    expect(
      oxygenFollowUpOrderSchema.safeParse({ ...order, ...fields }).success
    ).toBe(false);
  });
});
