import { describe, expect, it } from 'vitest';
import { resetRefinementsForQuery } from './reset-refinements-for-query';

describe('resetRefinementsForQuery', () => {
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
