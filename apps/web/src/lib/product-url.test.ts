import { describe, expect, it } from 'vitest';
import { getProductUrl } from './product-url';

const PRODUCTS = [
  {
    id: 'p1',
    name: 'Tecno Spark 40 Pro',
    slug: 'tecno-spark-40-pro',
    category: 'smartphones',
  },
  {
    id: 'p2',
    name: 'Dell Alienware M18 R2 (New)',
    categories: { name: 'Laptops', slug: 'premium-laptops' },
  },
  {
    id: 'p3',
    name: 'Generic Item',
    canonical_url: 'https://ogabassey.com/deals/generic-item',
  },
  { id: 'p4', name: 'No Slug At All' },
];

describe('getProductUrl (lightweight split)', () => {
  it('prefers category paths and falls back to product slugs', () => {
    expect(getProductUrl(PRODUCTS[0])).toBe('/smartphones/tecno-spark-40-pro');
    expect(getProductUrl(PRODUCTS[3])).toContain('no-slug-at-all');
  });

  it('routes category objects through the category slug', () => {
    // Category-object input (no top-level slug): the product slug derives
    // from the name under the category's slug.
    expect(getProductUrl(PRODUCTS[1])).toBe(
      '/premium-laptops/dell-alienware-m18-r2'
    );
  });

  it('honors the canonical URL path when present', () => {
    expect(getProductUrl(PRODUCTS[2])).toBe('/deals/generic-item');
  });

  it('falls back to the product collection for slugless items', () => {
    expect(getProductUrl(PRODUCTS[3])).toBe('/products/no-slug-at-all');
  });
});
