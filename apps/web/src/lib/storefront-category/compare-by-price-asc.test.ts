import { describe, expect, it } from 'vitest';
import type { CategoryHubProduct } from './category-hub-types';
import { compareByPriceAsc } from './compare-by-price-asc';

function makeProduct(
  slug: string,
  price: number,
  name = `Device ${slug}`
): CategoryHubProduct {
  return {
    id: slug,
    slug,
    name,
    brand: 'BrandX',
    condition: 'New',
    price,
    stock: 5,
    manage_stock: true,
    has_condition_offers: false,
    category_slug: 'test-category',
  };
}

describe('compareByPriceAsc', () => {
  it('sorts primarily by price ascending', () => {
    const p1 = makeProduct('p1', 300);
    const p2 = makeProduct('p2', 100);
    expect(compareByPriceAsc(p1, p2)).toBeGreaterThan(0);
    expect(compareByPriceAsc(p2, p1)).toBeLessThan(0);
  });

  it('breaks ties by name then slug', () => {
    const a = makeProduct('slug-b', 100, 'Alpha');
    const b = makeProduct('slug-a', 100, 'Beta');
    expect(compareByPriceAsc(a, b)).toBeLessThan(0);

    const sameName1 = makeProduct('slug-a', 100, 'Same');
    const sameName2 = makeProduct('slug-b', 100, 'Same');
    expect(compareByPriceAsc(sameName1, sameName2)).toBeLessThan(0);
  });
});
