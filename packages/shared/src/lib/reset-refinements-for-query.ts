import { emptySearchRefinements } from './empty-search-refinements';
import { buildProductSearchQuery } from './product-search';
import type { SearchRefinements } from './search-refinement-types';

export function resetRefinementsForQuery(
  previous: string,
  next: string,
  current: SearchRefinements
): SearchRefinements {
  return buildProductSearchQuery(previous).normalized ===
    buildProductSearchQuery(next).normalized
    ? current
    : emptySearchRefinements();
}
