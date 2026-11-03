import { describe, expect, it } from 'vitest';
import { isResumedDirectPayment } from './is-resumed-direct-payment';
import type { ResumedOrder } from './types';

const order: ResumedOrder = {
  id: 'synthetic-order',
  short_id: 'TEST-ORDER',
  shipping_cost: 0,
  total: 1000,
  customer_name: 'Checkout Test',
  customer_email: 'checkout@example.invalid',
  customer_phone: '+2348000000000',
  shipping_address: {
    address: '12 Example Road',
    city: 'Ikeja',
    state: 'Lagos',
    phone: '+2348000000000',
  },
  items: [],
};

describe('isResumedDirectPayment', () => {
  it.each([
    'credpal',
    'credit_direct',
  ] as const)('allows the existing %s order only when there is no active cart', (preferredGateway) => {
    expect(
      isResumedDirectPayment({
        resumedOrder: order,
        preferredGateway,
        checkoutItemCount: 0,
      })
    ).toBe(true);
    expect(
      isResumedDirectPayment({
        resumedOrder: order,
        preferredGateway,
        checkoutItemCount: 1,
      })
    ).toBe(false);
  });

  it('requires both an existing order and its selected direct-payment gateway', () => {
    expect(
      isResumedDirectPayment({
        resumedOrder: null,
        preferredGateway: 'credpal',
        checkoutItemCount: 0,
      })
    ).toBe(false);
    expect(
      isResumedDirectPayment({
        resumedOrder: order,
        preferredGateway: null,
        checkoutItemCount: 0,
      })
    ).toBe(false);
  });
});
