import { describe, expect, it } from 'vitest';
import { emptySearchRefinements } from './empty-search-refinements';
import { hasActiveSearchRefinements } from './has-active-search-refinements';

describe('hasActiveSearchRefinements', () => {
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
    // Same for a zero minimum price: it cannot exclude any valid price,
    // so it must not suppress the product-request action on zero-result
    // pages. A zero maximum still excludes everything and stays active.
    expect(
      hasActiveSearchRefinements({
        brands: [],
        sort: 'relevance',
        minPrice: 0,
      })
    ).toBe(false);
    expect(
      hasActiveSearchRefinements({
        brands: [],
        sort: 'relevance',
        minPrice: 100,
      })
    ).toBe(true);
  });
});
