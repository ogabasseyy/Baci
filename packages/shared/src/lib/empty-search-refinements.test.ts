import { expect, it } from 'vitest';
import { emptySearchRefinements } from './empty-search-refinements';

it('starts unfiltered on relevance sort', () => {
  expect(emptySearchRefinements()).toEqual({ brands: [], sort: 'relevance' });
});
