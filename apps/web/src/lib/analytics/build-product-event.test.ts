import { describe, expect, it } from 'vitest';
import { buildProductEvent } from './build-product-event';

describe('buildProductEvent', () => {
  it('builds an add_to_cart payload with the joined category name', () => {
    expect(
      buildProductEvent({
        currency: 'NGN',
        eventId: 'evt-1',
        eventType: 'add_to_cart',
        merchantId: 'merchant-1',
        product: {
          id: 'p1',
          name: 'Phone',
          price: 100,
          category: 'Legacy',
          categories: { id: 'c1', name: 'Phones' } as never,
        },
        quantity: 2,
      })
    ).toEqual({
      event_id: 'evt-1',
      event_type: 'add_to_cart',
      merchant_id: 'merchant-1',
      product_id: 'p1',
      product_name: 'Phone',
      product_category: 'Phones',
      product_price: 100,
      quantity: 2,
      currency: 'NGN',
    });
  });

  it('omits quantity and event id when not given', () => {
    const event = buildProductEvent({
      currency: 'NGN',
      eventType: 'product_view',
      merchantId: 'merchant-1',
      product: { id: 'p1', name: 'Phone', price: 100 },
    });

    expect(event).not.toHaveProperty('quantity');
    expect(event).not.toHaveProperty('event_id');
    expect(event.product_category).toBeUndefined();
  });

  it('sends a numeric template product id as a string', () => {
    const event = buildProductEvent({
      currency: 'NGN',
      eventType: 'product_view',
      merchantId: 'merchant-1',
      product: { id: 42, name: 'Phone', price: 100 } as never,
    });

    expect(event.product_id).toBe('42');
  });
});
