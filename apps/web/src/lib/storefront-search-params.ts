import { sanitizeSearchQuery } from './sanitize-core';

/**
 * Upper bound for the storefront `/search` page parameter. Keeps result
 * offsets bounded: deeper pages resolve through a first-page probe and
 * redirect to the last page with results instead of issuing a giant-offset
 * query.
 */
export const STOREFRONT_SEARCH_MAX_PAGE = 100;

/**
 * Maximum query every search entry point accepts and submits. Shared by
 * the navbar and the results-page form so the persistent header always
 * displays the full active query and Enter resubmits it identically.
 * Matches the sanitize backstop below: the route never searches more.
 */
export const STOREFRONT_SEARCH_MAX_QUERY_LENGTH = 200;

/**
 * Validates the raw `q` route parameter before search. Repeated parameters
 * arrive as arrays at runtime and are ambiguous, so only a single string is
 * accepted; anything else yields an empty (non-searching) query.
 */
export function parseStorefrontSearchQueryParam(
  queryParam: string | string[] | null | undefined
): string {
  if (typeof queryParam !== 'string') {
    return '';
  }

  return sanitizeSearchQuery(queryParam);
}
