import { describe, expect, it } from 'vitest';
import { assertPublicListingProductRows } from './assert-public-listing-product-rows';

describe('assertPublicListingProductRows', () => {
  it('narrows valid listing rows while preserving caller properties', () => {
    const rows = [
      {
        id: 'phone-1',
        name: 'iPhone 16 Pro',
        price: '999000',
        stock: '10',
        has_variants: true,
        manage_stock: false,
        categories: [{ name: 'Smartphones', slug: 'smartphones' }],
        extra_meta: { source: 'category-feed' },
      },
      {
        id: 'phone-2',
        name: 'Pixel 9',
        price: 799000,
        stock: 5,
        advertised_price: 799000,
        advertised_condition: 'new',
      },
    ];

    expect(() => assertPublicListingProductRows(rows)).not.toThrow();
    assertPublicListingProductRows(rows);
    expect(rows[0].extra_meta).toEqual({ source: 'category-feed' });
    expect(rows[1].advertised_price).toBe(799000);
  });

  it('fails closed when row projection contains malformed product rows', () => {
    const malformed = [{ id: 'phone', price: 'not-a-number' }];
    expect(() =>
      assertPublicListingProductRows(
        malformed as unknown as Record<string, unknown>[]
      )
    ).toThrow('Invalid public listing product projection');
  });

  it.each([
    null,
    undefined,
    'not-an-array',
    12345,
    { id: 'not-an-array' },
  ])('fails closed when passed non-array input %j', (invalidInput) => {
    expect(() =>
      assertPublicListingProductRows(invalidInput as unknown as unknown[])
    ).toThrow('Invalid public listing product projection');
  });
});
