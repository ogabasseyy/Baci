import { describe, expect, it } from 'vitest';
import { mapApiOrderToResumedOrder } from './map-api-order-to-resumed-order';

describe('bugfix: restore gift-wrapping fees in resumed summaries', () => {
  it('maps persisted gift_wrapping_fee when resume URLs omit giftWrappingCost', () => {
    const resumed = mapApiOrderToResumedOrder({
      id: 'order-1',
      short_id: 'ORD-1',
      subtotal: 10000,
      shipping_cost: 1000,
      tax_amount: 750,
      discount_amount: 500,
      gift_wrapping_fee: 1500,
      total: 12750,
      customer_name: 'Ada Lovelace',
      customer_email: 'ada@example.com',
      customer_phone: '+2348000000000',
      shipping_address: {
        address: '1 Bridge St',
        city: 'Lagos',
        state: 'Lagos',
        phone: '+2348000000000',
      },
      items: [],
    });

    expect(resumed.gift_wrapping_fee).toBe(1500);
    expect(
      resumed.subtotal +
        resumed.shipping_cost +
        (resumed.tax_amount ?? 0) +
        (resumed.gift_wrapping_fee ?? 0) -
        (resumed.discount_amount ?? 0),
    ).toBe(resumed.total);
  });
});
