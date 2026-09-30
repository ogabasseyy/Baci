/**
 * Submission entries (search form, navbar, see-all, did-you-mean) never
 * carry a page parameter; only their renders count as new searches.
 */
export function buildSearchSubmissionHref(
  searchBasePath: string,
  targetQuery: string
): string {
  return `${searchBasePath}?q=${encodeURIComponent(targetQuery)}`;
}
