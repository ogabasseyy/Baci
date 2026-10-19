import { expect, it } from 'vitest';
import { SEARCH_SORT_OPTIONS } from './search-sort-options';

it('exposes the five sort orders', () => {
  expect(SEARCH_SORT_OPTIONS.map((option) => option.value)).toEqual([
    'relevance',
    'price_asc',
    'price_desc',
    'newest',
    'popular',
  ]);
});
