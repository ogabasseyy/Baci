import { describe, expect, it } from 'vitest';
import { oxygenFollowUpOrdersSchema } from './oxygen-follow-up-order';

const id = '20000000-0000-4000-8000-000000000001';
const order = {
  id,
  order_number: null,
  customer_id: null,
  customer_name: null,
  customer_email: null,
  customer_phone: null,
  total: null,
  payment_status: null,
  payment_method: null,
  created_at: '2026-11-17T09:00:00Z',
  cancelled_at: null,
};

describe('oxygenFollowUpOrdersSchema', () => {
  it('accepts nullable order details but rejects malformed or excessive records', () => {
    expect(oxygenFollowUpOrdersSchema.safeParse([order]).success).toBe(true);
    expect(
      oxygenFollowUpOrdersSchema.safeParse(Array(250).fill(order)).success
    ).toBe(true);
    expect(
      oxygenFollowUpOrdersSchema.safeParse([
        { ...order, total: '12000.50', customer_id: id },
      ]).success
    ).toBe(true);
    expect(
      oxygenFollowUpOrdersSchema.safeParse(Array(251).fill(order)).success
    ).toBe(false);
    expect(
      oxygenFollowUpOrdersSchema.safeParse([
        { ...order, unexpected: 'private' },
      ]).success
    ).toBe(false);
    expect(
      oxygenFollowUpOrdersSchema.safeParse([{ ...order, id: 'invalid' }])
        .success
    ).toBe(false);
    expect(
      oxygenFollowUpOrdersSchema.safeParse([
        { ...order, created_at: 'invalid' },
      ]).success
    ).toBe(false);
    expect(
      oxygenFollowUpOrdersSchema.safeParse([{ ...order, total: {} }]).success
    ).toBe(false);
    for (const field of [
      'order_number',
      'customer_id',
      'customer_name',
      'customer_email',
      'customer_phone',
      'payment_status',
      'payment_method',
    ]) {
      expect(
        oxygenFollowUpOrdersSchema.safeParse([{ ...order, [field]: 42 }])
          .success
      ).toBe(false);
    }
  });
});
