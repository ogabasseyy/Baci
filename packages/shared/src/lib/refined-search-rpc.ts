import {
  deduplicateFacetChoices,
  type SearchRefinements,
} from './search-refinements';

// Matches SQL's 100 pages at the storefront's 20-row page size.
export const REFINED_SEARCH_MAX_OFFSET = 1980;

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
export interface RefinedSearchRow {
  productId: string;
  total: number;
  price?: number;
  variantId?: string;
  offerId?: string;
  condition?: string;
}
export function readRefinedSearchRows(value: unknown): RefinedSearchRow[] {
  if (!Array.isArray(value)) throw new Error('Search results unavailable');
  return value.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object')
      throw new Error('Search results unavailable');
    const row = entry as Record<string, unknown>;
    const total = Number(row.total_count);
    const price =
      row.effective_price == null ? undefined : Number(row.effective_price);
    if (
      typeof row.product_id !== 'string' ||
      !Number.isSafeInteger(total) ||
      total < 0 ||
      (price !== undefined && (!Number.isFinite(price) || price < 0))
    )
      throw new Error('Search results unavailable');
    return {
      productId: row.product_id,
      total,
      ...(price !== undefined ? { price } : {}),
      ...(typeof row.matched_variant_id === 'string'
        ? { variantId: row.matched_variant_id }
        : {}),
      ...(typeof row.matched_offer_id === 'string'
        ? { offerId: row.matched_offer_id }
        : {}),
      ...(typeof row.matched_condition === 'string'
        ? { condition: row.matched_condition }
        : {}),
    };
  });
}
