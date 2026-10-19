import { describe, expect, it } from 'vitest';
import { getRefinedSearchArgs } from './refined-search-args';
import type { SearchRefinements } from './search-refinement-types';

const criteria: SearchRefinements = {
  brands: ['Samsung', 'Apple', 'Samsung'],
  categoryId: 'cat-1',
  condition: 'used',
  minPrice: 100,
  maxPrice: 500,
  minRating: 4,
  sort: 'price_desc',
};

describe('refined-search-args', () => {
  it.each([
    { offset: 5000, expected: 1980 },
    { offset: 1980, expected: 1980 },
    { offset: 40, expected: 40 },
    { offset: 0, expected: 0 },
    { offset: -20, expected: 0 },
    { offset: 40.9, expected: 40 },
  ])('clamps offset $offset to $expected', ({ offset, expected }) => {
    expect(
      getRefinedSearchArgs('m1', 'phone', criteria, 20, offset)
    ).toMatchObject({ result_offset: expected });
  });

  it('builds RPC args with deduplicated sorted brands and null fallbacks', () => {
    expect(getRefinedSearchArgs('m1', 'phone', criteria, 20, 40)).toEqual({
      search_query: 'phone',
      merchant_id_param: 'm1',
      brands_filter: ['Apple', 'Samsung'],
      category_id_filter: 'cat-1',
      condition_filter: 'used',
      min_price_filter: 100,
      max_price_filter: 500,
      min_rating_filter: 4,
      sort_by: 'price_desc',
      result_limit: 20,
      result_offset: 40,
    });
  });

  it('dedupes brands by facet identity (trimmed, case-insensitive)', () => {
    expect(
      getRefinedSearchArgs(
        'm1',
        'phone',
        {
          brands: ['apple', 'Apple', ' Samsung ', 'SAMSUNG'],
          sort: 'relevance',
        },
        20
      )
    ).toMatchObject({ brands_filter: [' Samsung ', 'apple'] });
  });

  it('defaults the offset to zero and nulls every unset filter', () => {
    expect(
      getRefinedSearchArgs('m1', 'phone', { brands: [], sort: 'relevance' }, 20)
    ).toEqual({
      search_query: 'phone',
      merchant_id_param: 'm1',
      brands_filter: [],
      category_id_filter: null,
      condition_filter: null,
      min_price_filter: null,
      max_price_filter: null,
      min_rating_filter: null,
      sort_by: 'relevance',
      result_limit: 20,
      result_offset: 0,
    });
  });

  it('forwards the processor filter only when a processor is selected', () => {
    expect(
      getRefinedSearchArgs(
        'm1',
        'laptop',
        { brands: [], processor: 'M4', sort: 'relevance' },
        20
      ).processor_filter
    ).toBe('M4');
    expect(
      getRefinedSearchArgs(
        'm1',
        'laptop',
        { brands: [], sort: 'relevance' },
        20
      )
    ).not.toHaveProperty('processor_filter');
  });
});
