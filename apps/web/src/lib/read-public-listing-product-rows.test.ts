import { describe, expect, it } from 'vitest';
import { readPublicListingProductRows } from './read-public-listing-product-rows';

describe('public listing runtime select boundary', () => {
  it('preserves selected product facts and extra safe columns without guessing absent values', () => {
    const rows = [
      {
        id: 'phone',
        name: 'iPhone 16',
        price: '600000',
        stock: '0',
        has_variants: true,
        manage_stock: false,
        categories: [{ name: 'Smartphones', slug: 'smartphones' }],
        product_key_specs: [{ ram_gb: 8 }],
      },
      { id: 'legacy', name: 'Legacy row' },
    ];
    expect(readPublicListingProductRows(rows)).toEqual(rows);
    expect(readPublicListingProductRows(rows)[1]).not.toHaveProperty('price');
  });
  it.each([
    null,
    ['select parse error'],
    [{ error: true }],
    [{ id: 'phone', price: 'not-a-price' }],
    [{ id: 'phone', has_variants: 'yes' }],
    [{ id: 'phone', manage_stock: 'false' }],
    [{ id: 'phone', categories: [{ name: 5 }] }],
    [{ id: 'phone', advertised_image: null }],
    [{ id: 'phone', advertised_price: null }],
  ])('fails closed for malformed projection %j', (value) => {
    expect(() => readPublicListingProductRows(value)).toThrow(
      'Invalid public listing product projection'
    );
  });
});
