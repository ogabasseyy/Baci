import { describe, expect, it } from 'vitest';
import { mapOrderItemsWithRoutes } from './map-order-items-with-routes';

describe('mapOrderItemsWithRoutes', () => {
  it('maps item names, product routes, and canonical condition labels', () => {
    const items = mapOrderItemsWithRoutes(
      [
        {
          id: 'item-1',
          product_id: 'product-1',
          condition: 'used',
          name: 'Fallback name',
          quantity: 1,
          price: 5000,
        },
      ],
      new Map([
        [
          'product-1',
          {
            product_slug: 'phone',
            category: 'phones',
            category_slug: 'smartphones',
            gtin: '0123456789012',
            categories: { name: 'Smartphones', slug: 'smartphones' },
          },
        ],
      ])
    );

    expect(items[0]).toMatchObject({
      name: 'Fallback name',
      product_name: 'Fallback name',
      product_slug: 'phone',
      category_slug: 'smartphones',
      variant_name: 'Used',
    });
  });
});
