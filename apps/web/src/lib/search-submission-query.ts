/**
 * Single source of truth for the tracked/navigated query length. Matches the
 * entry-point limit (STOREFRONT_SEARCH_MAX_QUERY_LENGTH) so telemetry always
 * covers the exact query the user searched — a lower cap here would silently
 * record a prefix of long navigated queries.
 */
export const SEARCH_SUBMISSION_QUERY_MAX_LENGTH = 200;

/**
 * Trim and clamp a query to the shared limit without splitting surrogate
 * pairs: a slice boundary inside an emoji/astral character would leave an
 * unpaired surrogate and crash encodeURIComponent during render.
 */
export function truncateSearchSubmissionQuery(
  query: string,
  maxLength: number = SEARCH_SUBMISSION_QUERY_MAX_LENGTH
): string {
  return query
    .trim()
    .slice(0, maxLength)
    .replace(/[\uD800-\uDBFF]$/, '');
}
