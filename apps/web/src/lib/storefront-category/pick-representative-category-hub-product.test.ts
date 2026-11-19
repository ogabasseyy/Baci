import { describe, expect, it } from 'vitest';
import type { CategoryHubProduct } from './category-hub-types';
import { compareByPriceAsc } from './compare-by-price-asc';
import { pickRepresentativeCategoryHubProduct } from './pick-representative-category-hub-product';

function makeProduct(slug: string, price: number): CategoryHubProduct {
  return {
    id: slug,
    slug,
    name: `Device ${slug}`,
    brand: 'BrandX',
    condition: 'New',
    price,
    stock: 5,
    manage_stock: true,
    has_condition_offers: false,
    category_slug: 'test-category',
  };
}

describe('pickRepresentativeCategoryHubProduct', () => {
  it('returns null for empty products array', () => {
    expect(
      pickRepresentativeCategoryHubProduct([], compareByPriceAsc)
    ).toBeNull();
  });

  it('returns the top element after sorting with comparator', () => {
    const p1 = makeProduct('p1', 500);
    const p2 = makeProduct('p2', 200);
    const p3 = makeProduct('p3', 300);
    expect(
      pickRepresentativeCategoryHubProduct([p1, p2, p3], compareByPriceAsc)
        ?.slug
    ).toBe('p2');
  });
});
