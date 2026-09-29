import { describe, expect, it } from 'vitest';
import { getBlogCategoryLookup } from './get-blog-category-lookup';

describe('getBlogCategoryLookup', () => {
  it('keeps exact candidates and canonical punctuation variants', () => {
    const lookup = getBlogCategoryLookup(["women's-fashion", 'product-news']);

    expect(lookup.candidates).toEqual([
      "women's-fashion",
      "women's fashion",
      "Women's Fashion",
      'product-news',
      'product news',
      'Product News',
    ]);
    expect(lookup.canonicalSlugs).toEqual(['womens-fashion', 'product-news']);
    expect(lookup.canonicalFilter).toContain(
      'category.ilike.*w*o*m*e*n*s*f*a*s*h*i*o*n*'
    );
    expect(lookup.canonicalFilter).toContain('category.ilike.*product*news*');
  });

  it('splits high-cardinality canonical filters into bounded query groups', () => {
    const categories = Array.from(
      { length: 80 },
      (_, index) => `category-${index}-with-a-long-descriptor`
    );

    const lookup = getBlogCategoryLookup(categories);

    expect(lookup.canonicalFilters.length).toBeGreaterThan(1);
    expect(lookup.canonicalFilters.length).toBeLessThanOrEqual(8);
    expect(
      lookup.canonicalFilters.every((filter) => filter.length <= 2500)
    ).toBe(true);
    expect(lookup.canonicalFilter).toBe(lookup.canonicalFilters.join(','));
  });

  it('bounds an individual character-wildcard filter for an oversized slug', () => {
    const lookup = getBlogCategoryLookup([`category-${'x'.repeat(3000)}`]);

    expect(lookup.canonicalFilters.length).toBeGreaterThan(0);
    expect(
      lookup.canonicalFilters.every((filter) => filter.length <= 2500)
    ).toBe(true);
  });
});
