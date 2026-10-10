import type { SearchRefinements } from './search-refinement-types';

export function hasActiveSearchRefinements(
  criteria: SearchRefinements
): boolean {
  // Sort order never empties a result set, so only filter-bearing fields
  // count. Used to suppress product-request intake on refinement-only
  // zero-result pages.
  return (
    criteria.brands.length > 0 ||
    criteria.categoryId !== undefined ||
    criteria.condition !== undefined ||
    // A zero minimum price filters nothing (prices are >= 0), so it counts
    // as absent like the zero rating floor — a maxPrice of zero still
    // excludes every positive price and stays active.
    (criteria.minPrice ?? 0) > 0 ||
    criteria.maxPrice !== undefined ||
    // A zero floor filters nothing (ratings are >= 0), so it counts as
    // absent — matching the chips, which show no rating chip for zero.
    (criteria.minRating ?? 0) > 0 ||
    criteria.processor !== undefined
  );
}
