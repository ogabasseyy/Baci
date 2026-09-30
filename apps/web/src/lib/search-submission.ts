export type SearchSubmissionSource =
  | 'navbar'
  | 'results-form'
  | 'see-all'
  | 'did-you-mean';

/** Called only by submission handlers. Never await or retry telemetry navigation. */
export function recordSearchSubmission(
  query: string,
  pathPrefix: string,
  source: SearchSubmissionSource
): void {
  const trimmedQuery = query.trim().slice(0, 100);
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
