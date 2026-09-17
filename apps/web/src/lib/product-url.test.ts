import { describe, expect, it } from 'vitest';
import { getProductUrl } from './product-url';
import { getProductUrl as canonicalGetProductUrl } from './seo-utils';

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
  it('matches the canonical seo-utils implementation exactly', () => {
    for (const product of PRODUCTS) {
      expect(getProductUrl(product)).toBe(canonicalGetProductUrl(product));
    }
  });

  it('prefers category paths and falls back to product slugs', () => {
    expect(getProductUrl(PRODUCTS[0])).toBe('/smartphones/tecno-spark-40-pro');
    expect(getProductUrl(PRODUCTS[3])).toContain('no-slug-at-all');
  });
});
