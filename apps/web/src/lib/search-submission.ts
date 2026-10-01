/**
 * Single source of truth for the tracked/navigated query length. Matches the
 * entry-point limit (STOREFRONT_SEARCH_MAX_QUERY_LENGTH) so telemetry always
 * covers the exact query the user searched — a lower cap here would silently
 * record a prefix of long navigated queries.
 */
export const SEARCH_SUBMISSION_QUERY_MAX_LENGTH = 200;

/**
 * Allowed submission sources, defined once. The Zod schema and every client
 * call site derive from these tuples so a rename/add cannot compile on the
 * client while being rejected by the endpoint at runtime.
 */
export const SEARCH_SUBMISSION_SOURCES = [
  'navbar',
  'results-form',
  'see-all',
  'did-you-mean',
  'popular-search',
] as const;

export type SearchSubmissionSource = (typeof SEARCH_SUBMISSION_SOURCES)[number];

export const SEARCH_SUBMISSION_LINK_SOURCES = [
  'did-you-mean',
] as const satisfies readonly SearchSubmissionSource[];

export type SearchSubmissionLinkSource =
  (typeof SEARCH_SUBMISSION_LINK_SOURCES)[number];

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

/** Called only by submission handlers. Never await or retry telemetry navigation. */
export function recordSearchSubmission(
  query: string,
  pathPrefix: string,
  source: SearchSubmissionSource
): void {
  const trimmedQuery = truncateSearchSubmissionQuery(query);
  if (!trimmedQuery) return;
  try {
    void fetch('/api/search/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: trimmedQuery, pathPrefix, source }),
      keepalive: true,
    }).catch(() => {
      /* Search still works when analytics is unavailable. */
    });
  } catch {
    /* Search still works when fetch is unavailable. */
  }
}
