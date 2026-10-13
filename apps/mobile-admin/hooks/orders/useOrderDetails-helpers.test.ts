import { describe, expect, it } from 'vitest';
import { mapOrderItems } from './useOrderDetails-helpers';

describe('mapOrderItems', () => {
  it('maps item and product fallbacks for order details', () => {
    const result = mapOrderItems([
      {
        condition: null,
        has_assurance: true,
        id: 'item-1',
        image_url: null,
        item_description: 'A replacement screen',
        name: null,
        price: 12500,
        product_match_status: 'linked',
        product_id: 'product-1',
        products: {
          categories: { name: 'Phones', slug: 'phones' },
          category: 'Legacy phones',
          condition: 'New',
          images: ['https://example.com/phone.jpg'],
          name: 'Phone',
        },
        quantity: 2,
        variant_attributes: { color: 'Black' },
        variant_id: 'variant-1',
        variant_name: 'Black',
      },
    ]);

    expect(result).toEqual([
      expect.objectContaining({
        category: 'Phones',
        category_slug: 'phones',
        details: 'A replacement screen',
        display_condition: 'New',
        display_image_url: 'https://example.com/phone.jpg',
        has_assurance: true,
        name: 'Phone',
        product_name: 'Phone',
        quantity: 2,
        variant_id: 'variant-1',
      }),
    ]);
  });

  it('returns no items for an absent item collection', () => {
    expect(mapOrderItems(null)).toEqual([]);
  });
});
