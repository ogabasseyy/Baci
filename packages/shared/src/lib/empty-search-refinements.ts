import type { SearchRefinements } from './search-refinement-types';

export const emptySearchRefinements = (): SearchRefinements => ({
  brands: [],
  sort: 'relevance',
});
