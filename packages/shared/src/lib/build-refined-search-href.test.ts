import { describe, expect, it } from 'vitest';
import { buildRefinedSearchHref } from './build-refined-search-href';
import { parseSearchRefinements } from './parse-search-refinements';

describe('buildRefinedSearchHref', () => {
  it('serializes parsed filters with encoding and pagination', () => {
    const result = parseSearchRefinements({
      brand: [' Apple ', 'Samsung', ' Apple '],
      maxPrice: '0',
      sort: 'price_desc',
    });
    if (!result.success) throw new Error('Expected valid filters');
    expect(
      buildRefinedSearchHref('/oga/search', 'phone & tablet', result.data, 2)
    ).toBe(
      '/oga/search?q=phone+%26+tablet&brand=+Apple+&brand=Samsung&maxPrice=0&sort=price_desc&page=2'
    );
  });
  it('carries the processor filter', () => {
    const parsed = parseSearchRefinements({ processor: 'Intel Core i7' });
    if (!parsed.success) throw new Error('Expected valid filters');
    expect(buildRefinedSearchHref('/search', 'laptop', parsed.data)).toContain(
      'processor=Intel+Core+i7'
    );
  });
});
