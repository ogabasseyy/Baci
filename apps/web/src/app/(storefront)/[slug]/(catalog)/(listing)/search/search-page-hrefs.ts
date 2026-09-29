import { buildStorefrontPageHref } from '@/lib/storefront-pagination';

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

/**
 * Navigational search URLs (redirect targets, pagination links).
 * Page-1 targets carry an explicit page parameter so landing on them never
 * counts as a fresh search submission the way a submission entry does.
 */
export function buildSearchHref(
  searchBasePath: string,
  targetQuery: string,
  targetPage: number
): string {
  const pageOneHref = targetQuery
    ? buildSearchSubmissionHref(searchBasePath, targetQuery)
    : searchBasePath;
  if (targetQuery && targetPage <= 1) {
    return `${pageOneHref}&page=1`;
  }
  return buildStorefrontPageHref(pageOneHref, targetPage);
}
