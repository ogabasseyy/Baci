import { buildProductSearchQuery } from '@baci/shared';

/**
 * Whether a trimmed query can produce matches. Uses the exact
 * normalization the product fetch applies, so punctuation-only input
 * (e.g. "!!") — which the fetch deliberately resolves to zero matches —
 * is rejected at every entry point instead of presenting a misleading
 * no-results journey for a query that was never searchable.
 */
export function isSearchableQuery(query: string): boolean {
  return buildProductSearchQuery(query).normalized !== '';
}
