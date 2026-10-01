/**
 * Submission entries (search form, navbar, see-all, did-you-mean) never
 * carry a page parameter; only explicit activation records a submission,
 * never the landing render.
 */
export function buildSearchSubmissionHref(
  searchBasePath: string,
  targetQuery: string
): string {
  return `${searchBasePath}?q=${encodeURIComponent(targetQuery)}`;
}
