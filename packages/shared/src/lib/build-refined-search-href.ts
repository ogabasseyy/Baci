import type { SearchRefinements } from './search-refinement-types';

export function buildRefinedSearchHref(
  path: string,
  query: string,
  criteria: SearchRefinements,
  page?: number
): string {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  for (const brand of [...new Set(criteria.brands)].sort())
    params.append('brand', brand);
  if (criteria.categoryId) params.set('category', criteria.categoryId);
  if (criteria.condition) params.set('condition', criteria.condition);
  if (criteria.processor) params.set('processor', criteria.processor);
  for (const key of ['minPrice', 'maxPrice', 'minRating'] as const) {
    if (criteria[key] !== undefined) params.set(key, String(criteria[key]));
  }
  if (criteria.sort !== 'relevance') params.set('sort', criteria.sort);
  if (query && page !== undefined) params.set('page', String(page));
  return params.size ? `${path}?${params}` : path;
}
