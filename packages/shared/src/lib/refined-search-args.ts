import { deduplicateFacetChoices } from './deduplicate-facet-choices';
import { REFINED_SEARCH_MAX_OFFSET } from './refined-search-constants';
import type { SearchRefinements } from './search-refinement-types';

export function getRefinedSearchArgs(
  merchantId: string,
  query: string,
  criteria: SearchRefinements,
  limit: number,
  offset = 0
) {
  // Clamp to the SQL window: past 1980 the RPC raises 22023 and readers
  // surface a generic failure. Out-of-range pages snap to the nearest
  // valid offset instead of failing (web probes + redirects before this;
  // native deep links and long tails land here).
  const boundedOffset = Math.min(
    Math.max(0, Math.trunc(offset)),
    REFINED_SEARCH_MAX_OFFSET
  );
  return {
    ...(criteria.processor ? { processor_filter: criteria.processor } : {}),
    search_query: query,
    merchant_id_param: merchantId,
    // SQL matches lower(btrim()) so dedupe on facet identity: brand=Apple
    // beside brand=apple is one facet, first spelling wins.
    brands_filter: deduplicateFacetChoices(criteria.brands).sort(),
    category_id_filter: criteria.categoryId ?? null,
    condition_filter: criteria.condition ?? null,
    min_price_filter: criteria.minPrice ?? null,
    max_price_filter: criteria.maxPrice ?? null,
    min_rating_filter: criteria.minRating ?? null,
    sort_by: criteria.sort,
    result_limit: limit,
    result_offset: boundedOffset,
  };
}
