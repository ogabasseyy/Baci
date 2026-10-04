import { truncateSearchSubmissionQuery } from './search-submission-query';

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
