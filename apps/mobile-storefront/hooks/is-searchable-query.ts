import { buildProductSearchQuery } from '@baci/shared';
import { MIN_SEARCH_QUERY_LENGTH } from '@/constants/search';

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

/**
 * Shopper-facing validation copy for a rejected commit. A query can fail
 * in two ways — too short, or long enough but normalization-empty (e.g.
 * "!!") — and the length-only message misleads in the second case by
 * telling the shopper to type characters they already typed. Pass the
 * trimmed current input.
 */
export function getSearchHintLabel(trimmedQuery: string): string {
  const needsSearchableTerm =
    trimmedQuery.length >= MIN_SEARCH_QUERY_LENGTH &&
    !isSearchableQuery(trimmedQuery);
  return needsSearchableTerm
    ? 'Type letters or numbers to search'
    : `Type at least ${MIN_SEARCH_QUERY_LENGTH} characters to search`;
}
