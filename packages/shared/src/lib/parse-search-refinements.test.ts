import { describe, expect, it } from 'vitest';
import { parseSearchRefinements } from './parse-search-refinements';

describe('parseSearchRefinements', () => {
  it('keeps exact multi-brand values and deduplicates them', () => {
    expect(
      parseSearchRefinements({
        brand: [' Apple ', 'Samsung', ' Apple '],
        maxPrice: '0',
        sort: 'price_desc',
      })
    ).toEqual({
      success: true,
      data: { brands: [' Apple ', 'Samsung'], sort: 'price_desc', maxPrice: 0 },
    });
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
  it('round-trips processor filters and rejects malformed multi-value input', () => {
    const parsed = parseSearchRefinements({ processor: 'Intel Core i7' });
    expect(parsed.success).toBe(true);
    expect(
      parseSearchRefinements({ processor: ['Intel Core i7', 'AMD Ryzen 5'] })
        .success
    ).toBe(false);
  });
});
