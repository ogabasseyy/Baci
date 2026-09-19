import { describe, expect, it } from '@jest/globals';
import type { TrackOrderData } from '@/components/track-order/TrackOrderScreen.types';
import { toTrackedCompletionAttribution } from './tracked-order-completion';

const customer: TrackOrderData['customer'] = {
  name: 'Ada Buyer',
  email: 'ada@example.com',
  phone: '+2348123456789',
};

function orderWith(
  overrides: Partial<TrackOrderData['order']>
): TrackOrderData['order'] {
  return {
    id: 'order-1',
    order_number: 'ORD-1',
    status: 'processing',
    payment_status: 'paid',
    created_at: '2026-09-19T00:00:00.000Z',
    subtotal: 100000,
    shipping_cost: 0,
    discount_amount: 0,
    total: 107500,
    currency: 'NGN',
    ...overrides,
  };
}

describe('toTrackedCompletionAttribution', () => {
  it('derives VAT and maps line items', () => {
    expect(
      toTrackedCompletionAttribution(orderWith({}), customer, [
        {
          id: 'line-1',
          product_id: 'prod-1',
          product_name: 'iPhone 15 Pro',
          quantity: 1,
          unit_price: 100000,
          total_price: 100000,
          product_image: null,
        },
      ])
    ).toEqual({
      customerEmail: 'ada@example.com',
      customerPhone: '+2348123456789',
      items: [
        {
          product_id: 'prod-1',
          quantity: 1,
          price: 100000,
          name: 'iPhone 15 Pro',
        },
      ],
      shipping: 0,
      subtotal: 100000,
      tax: 7500,
      total: 107500,
    });
  });

  it('omits tax when the derivation would go negative', () => {
    const attribution = toTrackedCompletionAttribution(
      orderWith({ subtotal: 200000 }),
      customer,
      []
    );

    expect(attribution.tax).toBeUndefined();
    expect(attribution).not.toHaveProperty('items');
  });

  it('returns empty attribution without an order', () => {
    expect(toTrackedCompletionAttribution(null, customer, [])).toEqual({});
  });

  it('prefers the authoritative tax amount from the projection', () => {
    const attribution = toTrackedCompletionAttribution(
      orderWith({ tax_amount: 7500, gift_wrapping_fee: 0 }),
      customer,
      []
    );

    expect(attribution.tax).toBe(7500);
  });

  it('excludes gift wrapping when deriving settlement tax', () => {
    // total = 100000 subtotal + 0 shipping + 2500 gift wrap + 7500 tax.
    const attribution = toTrackedCompletionAttribution(
      orderWith({
        total: 110000,
        gift_wrapping_fee: 2500,
        tax_amount: null,
      }),
      customer,
      []
    );

    expect(attribution.tax).toBe(7500);
  });

  it('derives tax for legacy projections without wrapping fields', () => {
    const attribution = toTrackedCompletionAttribution(
      orderWith({}),
      customer,
      []
    );

    expect(attribution.tax).toBe(7500);
  });
});
