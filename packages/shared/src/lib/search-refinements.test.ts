import { describe, expect, it } from 'vitest';
import {
  buildRefinedSearchHref,
  emptySearchRefinements,
  hasActiveSearchRefinements,
  parseSearchRefinements,
  resetRefinementsForQuery,
} from './search-refinements';

describe('search refinements', () => {
  it('keeps exact multi-brand values and deduplicates them in links', () => {
    const result = parseSearchRefinements({
      brand: [' Apple ', 'Samsung', ' Apple '],
      maxPrice: '0',
      sort: 'price_desc',
    });
    expect(result).toEqual({
      success: true,
      data: { brands: [' Apple ', 'Samsung'], sort: 'price_desc', maxPrice: 0 },
    });
    if (!result.success) throw new Error('Expected valid filters');
    expect(
      buildRefinedSearchHref('/oga/search', 'phone & tablet', result.data, 2)
    ).toBe(
      '/oga/search?q=phone+%26+tablet&brand=+Apple+&brand=Samsung&maxPrice=0&sort=price_desc&page=2'
    );
  });
  it.each([
    { minPrice: '-1' },
    { maxPrice: 'Infinity' },
    { minPrice: '30', maxPrice: '20' },
    { condition: ['new', 'used'] },
    { category: 'not-a-uuid' },
    { brand: '   ' },
  ])('rejects invalid constraints instead of dropping them: %j', (input) => {
    expect(parseSearchRefinements(input).success).toBe(false);
  });
  it('defaults unknown sort to relevance and leaves blank bounds unrestricted', () => {
    expect(
      parseSearchRefinements({ sort: 'rating', minPrice: '', maxPrice: ' ' })
    ).toEqual({ success: true, data: { brands: [], sort: 'relevance' } });
  });
  it('detects filter-bearing refinements but ignores sort alone', () => {
    expect(hasActiveSearchRefinements(emptySearchRefinements())).toBe(false);
    expect(hasActiveSearchRefinements({ brands: [], sort: 'price_asc' })).toBe(
      false
    );
    expect(
      hasActiveSearchRefinements({
        brands: [],
        sort: 'relevance',
        maxPrice: 0,
      })
    ).toBe(true);
    expect(
      hasActiveSearchRefinements({
        brands: ['Apple'],
        sort: 'relevance',
      })
    ).toBe(true);
    expect(
      hasActiveSearchRefinements({
        brands: [],
        sort: 'relevance',
        minRating: 4,
      })
    ).toBe(true);
    // A zero floor filters nothing, so it counts as absent — matching the
    // chips, which show no rating chip for zero.
    expect(
      hasActiveSearchRefinements({
        brands: [],
        sort: 'relevance',
        minRating: 0,
      })
    ).toBe(false);
  });
  it('preserves same normalized query refinements and resets a different query', () => {
    const current = {
      brands: ['Apple'],
      sort: 'newest' as const,
      minPrice: 100,
    };
    expect(resetRefinementsForQuery('iPhone', ' iphone ', current)).toEqual(
      current
    );
    expect(resetRefinementsForQuery('iPhone', 'laptop', current)).toEqual({
      brands: [],
      sort: 'relevance',
    });
  });
});

it('round-trips processor filters and rejects malformed multi-value input', () => {
  const parsed = parseSearchRefinements({ processor: 'Intel Core i7' });
  expect(parsed.success).toBe(true);
  if (parsed.success) {
    expect(buildRefinedSearchHref('/search', 'laptop', parsed.data)).toContain(
      'processor=Intel+Core+i7'
    );
  }
  expect(
    parseSearchRefinements({ processor: ['Intel Core i7', 'AMD Ryzen 5'] })
      .success
  ).toBe(false);
});
