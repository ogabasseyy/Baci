import { describe, expect, it } from 'vitest';
import { isEligibleOrderForPaystackDva } from './is-eligible-order-for-paystack-dva';

describe('isEligibleOrderForPaystackDva', () => {
  it('accepts collectible, non-cancelled orders', () => {
    expect(
      isEligibleOrderForPaystackDva({
        payment_status: 'partially_paid',
        shipping_status: 'pending',
      })
    ).toBe(true);
  });

  it('rejects settled or cancelled orders', () => {
    expect(
      isEligibleOrderForPaystackDva({
        payment_status: 'paid',
        shipping_status: 'pending',
      })
    ).toBe(false);
    expect(
      isEligibleOrderForPaystackDva({
        payment_status: 'unpaid',
        shipping_status: 'cancelled',
      })
    ).toBe(false);
    expect(
      isEligibleOrderForPaystackDva({
        cancelled_at: '2026-08-24T12:00:00.000Z',
        payment_status: 'unpaid',
        shipping_status: 'pending',
      })
    ).toBe(false);
  });
});
