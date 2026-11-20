import { describe, expect, it } from 'vitest';
import { retainedFollowUpOrderSchema } from './retained-follow-up-order';

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
  created_at: null,
  cancelled_at: null,
};

describe('retainedFollowUpOrderSchema', () => {
  it.each([
    null,
    '2026-11-20T09:00:00+01:00',
  ])('accepts the creation timestamp %s', (createdAt) => {
    const row = { ...order, created_at: createdAt };
    expect(retainedFollowUpOrderSchema.parse(row)).toEqual(row);
  });

  it.each([
    { created_at: 'yesterday' },
    { created_at: '2026-11-20T09:00:00' },
    { created_at: undefined },
    { provider_data: 'private' },
  ])('rejects a malformed or unexpected field: %j', (fields) => {
    expect(
      retainedFollowUpOrderSchema.safeParse({ ...order, ...fields }).success
    ).toBe(false);
  });
});
