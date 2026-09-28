import { describe, expect, it } from 'vitest';
import { matchesSingleWordDiscoveryQuery } from './search-products-relevance';

const catalog = [
  { name: 'DreamWorks Dragons Toy', category: 'Accessories', brand: null },
  { name: 'Dell G15 Gaming Laptop', category: 'Laptops', brand: 'Dell' },
  { name: 'Xiaomi Security Camera', category: 'Accessories', brand: 'Xiaomi' },
  { name: 'Apple 20W Fast Charger', category: 'Accessories', brand: 'Apple' },
  { name: 'Samsung Galaxy S24 Ultra', category: 'Smartphones', brand: 'Samsung' },
  { name: 'Redmi 15C 5G', category: 'Smartphones', brand: 'Xiaomi' },
];

describe('catalog discovery relevance evaluation', () => {
  it.each([
    { query: 'work', expected: [] },
    { query: 'work?', expected: [] },
    { query: 'work!', expected: [] },
    { query: 'gaming', expected: ['Dell G15 Gaming Laptop'] },
    { query: 'camera', expected: ['Xiaomi Security Camera'] },
    { query: 'charger', expected: ['Apple 20W Fast Charger'] },
    { query: 'redmi', expected: ['Redmi 15C 5G'] },
    { query: 'samsung', expected: ['Samsung Galaxy S24 Ultra'] },
  ])('returns identifying-field matches for $query', ({ query, expected }) => {
    const selected = catalog
      .filter((product) => matchesSingleWordDiscoveryQuery(product, query, undefined))
      .map((product) => product.name);
    expect(selected).toEqual(expected);
  });

  it('preserves an explicit catalog category for a broad use case', () => {
    expect(matchesSingleWordDiscoveryQuery(catalog[1], 'work', 'Laptops')).toBe(true);
  });

  it('keeps a whole-word product-type match that appears only in the description', () => {
    expect(matchesSingleWordDiscoveryQuery({
      name: 'Aroma Machine', category: 'Accessories', description: 'Fragrance diffuser for rooms',
    }, 'diffuser', undefined)).toBe(true);
    expect(matchesSingleWordDiscoveryQuery({
      name: 'DreamWorks Toy', category: 'Accessories', description: 'Collectible figures',
    }, 'work', undefined)).toBe(false);
  });

  it('does not filter multiword product names or model numbers after ranked retrieval', () => {
    expect(matchesSingleWordDiscoveryQuery(catalog[4], 'Samsung Galaxy S24 Ultra', undefined)).toBe(true);
    expect(matchesSingleWordDiscoveryQuery(catalog[5], '15C', undefined)).toBe(true);
  });
});
