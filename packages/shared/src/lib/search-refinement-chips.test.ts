import { describe, expect, it } from 'vitest';
import { getSearchRefinementChips } from './search-refinement-chips';

describe('applied search filters', () => {
  it('dedupes case-equivalent brands into one chip that clears all', () => {
    const chips = getSearchRefinementChips(
      { brands: ['apple', ' Apple ', 'Samsung'], maxPrice: 0, sort: 'newest' },
      []
    );
    expect(chips.map((chip) => chip.key)).toEqual([
      'brand:apple',
      'brand:samsung',
      'price',
    ]);
    expect(chips[0].label).toBe('apple');
    expect(chips[0].next).toEqual({
      brands: ['Samsung'],
      maxPrice: 0,
      sort: 'newest',
    });
    expect(chips[2].next.maxPrice).toBeUndefined();
  });
  it('shows a rating chip for a positive floor but none for zero', () => {
    const rated = getSearchRefinementChips(
      { brands: [], sort: 'relevance', minRating: 4 },
      []
    );
    expect(rated.map((chip) => chip.key)).toEqual(['rating']);
    expect(rated[0].next.minRating).toBeUndefined();
    // Zero filters nothing, so no chip — matching hasActiveSearchRefinements.
    expect(
      getSearchRefinementChips(
        { brands: [], sort: 'relevance', minRating: 0 },
        []
      )
    ).toEqual([]);
  });
});

it('formats price chips in merchant currency without changing numeric criteria', () => {
  const criteria = {
    brands: [],
    sort: 'relevance' as const,
    minPrice: 100,
    maxPrice: 200,
  };
  const chip = getSearchRefinementChips(
    criteria,
    [],
    (price) => `$${price}`
  )[0];
  expect(chip.label).toContain('$100');
  expect(chip.label).toContain('$200');
  expect(chip.next.minPrice).toBeUndefined();
  expect(chip.next.maxPrice).toBeUndefined();
  expect(criteria.minPrice).toBe(100);
});
