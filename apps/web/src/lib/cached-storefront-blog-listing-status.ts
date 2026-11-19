import { cacheLife, cacheTag } from 'next/cache';
import {
  buildBlogCategoryHref,
  findBlogCategoryLabelBySlug,
  getBlogCategorySlug,
} from '@/app/(storefront)/[slug]/(blog)/blog/blog-category-routing';
import { buildBlogListingRouteHref } from '@/app/(storefront)/[slug]/(blog)/blog/blog-listing-route';
import { getBlogAuthorBySlug } from '@/lib/blog-authors';
import {
  getCachedBlogAuthor,
  getCachedBlogListing,
  getMerchantStrict,
} from '@/lib/cached-data';
import { toSafeInternalRedirectPath } from '@/lib/safe-internal-redirect-path';
import { getBlogPostsMerchantCacheTag } from '@/lib/tenant-cache-tags';

/**
 * Serializable status body for the blog **listing** routes, resolved before
 * React streaming so the proxy can emit real HTTP statuses. Mirrors the
 * `blog-post-status` body shape (#2883): `hasError` fails the caller open.
 */
export interface BlogListingStatusBody {
  hasError: boolean;
  redirectPath: string | null;
  /** `true` → 308 (category canonicalization); `false` → 307 (page clamp). */
  permanent: boolean;
  notFound: boolean;
  /**
   * Set when the NOOP comes from the unknown/unpublished-storefront gate, not
   * from a real listing resolution. The endpoint must NOT edge-cache these:
   * publish-state changes purge merchant tags only (never `blog-posts`), so a
   * cached pre-publish NOOP would suppress listing redirects/clamps after the
   * store goes live until the entry's natural TTL.
   */
  unpublishedStorefront?: boolean;
}

/** Parsed intent the proxy derives from a listing pathname + query. */
export type BlogListingStatusIntent =
  | { kind: 'category-query'; category: string }
  | { kind: 'listing-page'; page: number; category?: string }
  | { kind: 'category-page'; categorySlug: string; page: number }
  | { kind: 'author'; authorSlug: string; page: number };

const FAIL_OPEN: BlogListingStatusBody = {
  hasError: true,
  redirectPath: null,
  permanent: false,
  notFound: false,
};
const NOOP: BlogListingStatusBody = {
  hasError: false,
  redirectPath: null,
  permanent: false,
  notFound: false,
};

function redirectBody(path: string, permanent: boolean): BlogListingStatusBody {
  const redirectPath = toSafeInternalRedirectPath(path);
  return redirectPath
    ? { hasError: false, redirectPath, permanent, notFound: false }
    : NOOP;
}

function withPage(basePath: string, page: number): string {
  return page > 1 ? `${basePath}?page=${page}` : basePath;
}

async function resolveCategoryQuery(
  lookupKey: string,
  rawCategory: string
): Promise<BlogListingStatusBody> {
  const category = rawCategory.trim();
  if (!category) {
    return NOOP;
  }
  const data = await getCachedBlogListing(lookupKey, { page: 1 });
  if (!data) {
    return NOOP;
  }
  const knownLabel = findBlogCategoryLabelBySlug(
    data.categories,
    getBlogCategorySlug(category)
  );
  if (!knownLabel) {
    return NOOP;
  }
  const href = buildBlogCategoryHref('', knownLabel, data.categories);
  // A colliding/non-clean category resolves back to a query URL — no clean
  // redirect target, so leave it for the route to render. Canonicalization is a
  // permanent (308) redirect.
  return href.includes('?') ? NOOP : redirectBody(href, true);
}

async function resolveListingPage(
  lookupKey: string,
  page: number,
  category: string | undefined
): Promise<BlogListingStatusBody> {
  const data = await getCachedBlogListing(lookupKey, {
    page,
    ...(category ? { category } : {}),
  });
  if (!data || page <= data.totalPages) {
    return NOOP;
  }
  // Match the route's own clamp target: paginated (and query-category) listings
  // stay on the /blog?...&page=<last> query URL — only page 1 canonicalizes to a
  // clean category hub (handled by the category-query intent).
  return redirectBody(
    buildBlogListingRouteHref({
      storeBasePath: '',
      // Never clamp below page 1 (an empty listing reports totalPages: 0).
      page: Math.max(1, data.totalPages),
      ...(category ? { category } : {}),
    }),
    false
  );
}

async function resolveCategoryPage(
  lookupKey: string,
  categorySlug: string,
  page: number
): Promise<BlogListingStatusBody> {
  const data = await getCachedBlogListing(lookupKey, { page: 1 });
  if (!data) {
    return NOOP;
  }
  const label = findBlogCategoryLabelBySlug(data.categories, categorySlug);
  if (!label) {
    // Unknown clean category — the route returns a real notFound() itself.
    return NOOP;
  }
  const categoryData = await getCachedBlogListing(lookupKey, {
    page,
    category: label,
  });
  if (!categoryData || page <= categoryData.totalPages) {
    return NOOP;
  }
  // The clean category route paginates via the /blog?category=<label>&page=<n>
  // query URL (buildBlogListingRouteHref), so clamp to that, not the clean hub.
  return redirectBody(
    buildBlogListingRouteHref({
      storeBasePath: '',
      category: label,
      // Never clamp below page 1 (an empty category reports totalPages: 0).
      page: Math.max(1, categoryData.totalPages),
    }),
    false
  );
}

async function resolveAuthor(
  lookupKey: string,
  authorSlug: string,
  page: number
): Promise<BlogListingStatusBody> {
  // The canonical author URL is lowercase (the route normalizes it), so match
  // both the profile lookup and the redirect target to that.
  const normalizedAuthorSlug = authorSlug.toLowerCase();
  const profile = getBlogAuthorBySlug(normalizedAuthorSlug, lookupKey);
  if (!profile) {
    // Unknown author is already resolved before the shell in the route.
    return NOOP;
  }
  const data = await getCachedBlogAuthor(lookupKey, profile.name, { page });
  if (!data) {
    // Known author with no published posts → real 404.
    return {
      hasError: false,
      redirectPath: null,
      permanent: false,
      notFound: true,
    };
  }
  if (page > data.totalPages) {
    return redirectBody(
      withPage(`/blog/author/${normalizedAuthorSlug}`, data.totalPages),
      false
    );
  }
  return NOOP;
}

/**
 * Resolve the hard status for a blog listing/category/author request. Reuses
 * the same cached, RLS-safe data the routes render from, so it never double-
 * fetches uncached data.
 *
 * Uses the same `merchant` cache profile as the underlying listing/author data
 * so a warm instance never serves a stale clamp longer than the route would.
 * It does NOT catch transient throws: a Supabase timeout must propagate to the
 * endpoint's no-store handler (which fails open) rather than caching a
 * fail-open verdict here — mirroring the blog-post preflight.
 */
export async function getCachedStorefrontBlogListingStatus(
  identifier: string,
  intent: BlogListingStatusIntent
): Promise<BlogListingStatusBody> {
  'use cache';
  cacheLife('merchant');

  const lookupKey = identifier.trim().toLowerCase();
  cacheTag('blog-posts', `blog-listing-status-${lookupKey}`);
  if (!lookupKey) {
    return FAIL_OPEN;
  }

  // Unpublished storefronts render the StoreNotPublished shell, so never leak a
  // hard redirect/404 from the preflight (mirrors the blog-post preflight).
  // STRICT lookup: a transient merchant-lookup failure must THROW to the
  // endpoint's no-store fail-open handler — the safe variant would return the
  // same NOOP shape as a real listing, which the data cache AND the route's
  // CDN cache would then store for the whole TTL window. A strict null is a
  // definitive "no published storefront", which is safe to cache as NOOP.
  const merchant = await getMerchantStrict(lookupKey);
  if (!merchant?.is_published) {
    return { ...NOOP, unpublishedStorefront: true };
  }
  cacheTag(getBlogPostsMerchantCacheTag(merchant.id));

  switch (intent.kind) {
    case 'category-query':
      return await resolveCategoryQuery(lookupKey, intent.category);
    case 'listing-page':
      return await resolveListingPage(lookupKey, intent.page, intent.category);
    case 'category-page':
      return await resolveCategoryPage(
        lookupKey,
        intent.categorySlug,
        intent.page
      );
    case 'author':
      return await resolveAuthor(lookupKey, intent.authorSlug, intent.page);
    default:
      return NOOP;
  }
}
