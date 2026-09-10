import { isOgabasseyBlogStaticTenant } from './blog-category-routing';
import type { BlogSearchParamValue } from './blog-search-params';

const BLOG_LISTING_REQUEST_KEYS = ['category', 'page', 'search'] as const;

export function isUnfilteredOgabasseyBlogListing(
  slug: string,
  query: Record<string, BlogSearchParamValue>
): boolean {
  return (
    isOgabasseyBlogStaticTenant(slug) &&
    !BLOG_LISTING_REQUEST_KEYS.some((key) => query[key] !== undefined)
  );
}
