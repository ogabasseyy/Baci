import { buildStorefrontPageHref } from '@/lib/storefront-pagination';
import { buildSearchSubmissionHref } from './search-page-submission-href';

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
