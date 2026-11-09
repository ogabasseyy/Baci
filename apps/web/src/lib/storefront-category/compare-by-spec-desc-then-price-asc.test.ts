import { describe, expect, it } from 'vitest';
import type { CategoryHubProduct } from './category-hub-types';
import { compareBySpecDescThenPriceAsc } from './compare-by-spec-desc-then-price-asc';

function makeProduct(
  slug: string,
  price: number,
  specs: Record<string, unknown> = {},
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
    product_key_specs: specs,
  };
}

describe('compareBySpecDescThenPriceAsc', () => {
  const comparator = compareBySpecDescThenPriceAsc('ram_gb');

  it('sorts primarily by spec descending', () => {
    const highRam = makeProduct('high', 500, { ram_gb: 32 });
    const lowRam = makeProduct('low', 200, { ram_gb: 16 });
    expect(comparator(highRam, lowRam)).toBeLessThan(0);
    expect(comparator(lowRam, highRam)).toBeGreaterThan(0);
  });

  it('breaks spec ties by price ascending, then name, then slug', () => {
    const cheaper = makeProduct('cheap', 300, { ram_gb: 16 });
    const pricer = makeProduct('pricey', 500, { ram_gb: 16 });
    expect(comparator(cheaper, pricer)).toBeLessThan(0);

    const samePriceA = makeProduct('slug-b', 300, { ram_gb: 16 }, 'Alpha');
    const samePriceB = makeProduct('slug-a', 300, { ram_gb: 16 }, 'Beta');
    expect(comparator(samePriceA, samePriceB)).toBeLessThan(0);

    const sameName1 = makeProduct('slug-a', 300, { ram_gb: 16 }, 'Same');
    const sameName2 = makeProduct('slug-b', 300, { ram_gb: 16 }, 'Same');
    expect(comparator(sameName1, sameName2)).toBeLessThan(0);
  });
});
