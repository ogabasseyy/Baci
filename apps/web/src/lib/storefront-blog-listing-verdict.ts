import {
  buildBlogCategoryHref,
  findBlogCategoryLabelBySlug,
  findOgabasseyBlogCategoryAliasLabel,
  getBlogCategorySlug,
  isOgabasseyBlogStaticTenant,
} from '@/app/(storefront)/[slug]/(blog)/blog/blog-category-routing';
import { buildBlogListingRouteHref } from '@/app/(storefront)/[slug]/(blog)/blog/blog-listing-route';
import { BLOG_LISTING_PAGE_SIZE } from '@/lib/blog-listing-page-size';
import { filterPublicBlogCategories } from '@/lib/public-blog-content-quality';
import { toSafeInternalRedirectPath } from '@/lib/safe-internal-redirect-path';
import type { StorefrontBlogListingStatusRow } from '@/schemas/storefront-preflight-rpc';
import type { BlogListingStatusIntent } from './cached-storefront-blog-listing-status';

export type StorefrontBlogListingStatusResolution =
  | { kind: 'noop' }
  | { kind: 'notFound' }
  | { kind: 'redirect'; redirectPath: string; status: 307 | 308 };

const NOOP: StorefrontBlogListingStatusResolution = { kind: 'noop' };
const NOT_FOUND: StorefrontBlogListingStatusResolution = { kind: 'notFound' };

/**
 * Validate a TS-composed redirect path exactly as the resolver's `redirectBody`
 * did: an unsafe path degrades to NOOP (fall through to the App Router) rather
 * than emitting an off-site or malformed redirect.
 */
function redirect(
  path: string,
  status: 307 | 308
): StorefrontBlogListingStatusResolution {
  const redirectPath = toSafeInternalRedirectPath(path);
  return redirectPath ? { kind: 'redirect', redirectPath, status } : NOOP;
}

function totalPagesFor(count: number): number {
  return Math.ceil(count / BLOG_LISTING_PAGE_SIZE);
}

/**
 * Per-category published-post count via an exact-string lookup against the RAW
 * `blog_posts.category` keys the RPC returns — byte-identical to the resolver's
 * `getCachedBlogListing({ category }).eq('category', X)` count (an untrimmed or
 * absent DB value yields 0 on both paths).
 */
function countForCategory(
  row: StorefrontBlogListingStatusRow,
  label: string
): number {
  const index = row.categories.indexOf(label);
  return index === -1 ? 0 : (row.category_counts[index] ?? 0);
}

export function resolveCategoryQuery(
  rawCategory: string,
  categories: string[],
  identifier?: string | null
): StorefrontBlogListingStatusResolution;
export function resolveCategoryQuery(
  row: StorefrontBlogListingStatusRow,
  rawCategory: string,
  identifier?: string | null
): StorefrontBlogListingStatusResolution;
export function resolveCategoryQuery(
  first: string | StorefrontBlogListingStatusRow,
  second: string | string[],
  identifier?: string | null
): StorefrontBlogListingStatusResolution {
  let rawCategory: string;
  let rawCategories: string[];

  if (typeof first === 'string' && Array.isArray(second)) {
    rawCategory = first;
    rawCategories = second;
  } else if (typeof first !== 'string' && typeof second === 'string') {
    rawCategory = second;
    rawCategories = first.categories;
  } else {
    return NOOP;
  }

  const category = rawCategory.trim();
  if (!category) {
    return NOOP;
  }
  const categories = filterPublicBlogCategories(rawCategories);
  const targetSlug = getBlogCategorySlug(category);
  let knownLabel = findBlogCategoryLabelBySlug(categories, targetSlug);

  if (!knownLabel && identifier && isOgabasseyBlogStaticTenant(identifier)) {
    knownLabel = findOgabasseyBlogCategoryAliasLabel(categories, category);
  }

  if (!knownLabel) {
    return NOOP;
  }
  const href = buildBlogCategoryHref('', knownLabel, categories);
  // A colliding/non-clean category resolves back to a query URL — no clean
  // redirect target, so leave it for the route. Canonicalization is a 308.
  return href.includes('?') ? NOOP : redirect(href, 308);
}

function resolveListingPage(
  row: StorefrontBlogListingStatusRow,
  page: number,
  category: string | undefined
): StorefrontBlogListingStatusResolution {
  const count = category ? countForCategory(row, category) : row.total_count;
  const totalPages = totalPagesFor(count);
  if (page <= totalPages) {
    return NOOP;
  }
  // Match the route's clamp target: paginated (and query-category) listings stay
  // on the /blog?...&page=<last> query URL. Never clamp below page 1.
  return redirect(
    buildBlogListingRouteHref({
      storeBasePath: '',
      page: Math.max(1, totalPages),
      ...(category ? { category } : {}),
    }),
    307
  );
}

function resolveCategoryPage(
  row: StorefrontBlogListingStatusRow,
  categorySlug: string,
  page: number
): StorefrontBlogListingStatusResolution {
  const categories = filterPublicBlogCategories(row.categories);
  const label = findBlogCategoryLabelBySlug(categories, categorySlug);
  if (!label) {
    // Unknown clean category — the route returns its own notFound().
    return NOOP;
  }
  const count = countForCategory(row, label);
  const totalPages = totalPagesFor(count);
  if (page <= totalPages) {
    return NOOP;
  }
  // The clean category route paginates via the /blog?category=<label>&page=<n>
  // query URL, so clamp to that, not the clean hub.
  return redirect(
    buildBlogListingRouteHref({
      storeBasePath: '',
      category: label,
      page: Math.max(1, totalPages),
    }),
    307
  );
}

function resolveAuthor(
  row: StorefrontBlogListingStatusRow,
  authorSlug: string,
  page: number
): StorefrontBlogListingStatusResolution {
  // The resolver's getCachedBlogAuthor returns null for BOTH a blog-disabled
  // storefront and a known author with zero published posts, and resolveAuthor
  // maps that null to a real 404. Mirror both.
  if (!row.blog_enabled || row.author_count === 0) {
    return NOT_FOUND;
  }
  const totalPages = Math.max(1, totalPagesFor(row.author_count));
  if (page > totalPages) {
    // The canonical author URL is lowercase (the route normalizes it).
    const normalizedAuthorSlug = authorSlug.toLowerCase();
    const base = `/blog/author/${normalizedAuthorSlug}`;
    return redirect(totalPages > 1 ? `${base}?page=${totalPages}` : base, 307);
  }
  return NOOP;
}

export interface EvaluateBlogListingRequestOptions {
  identifier?: string | null;
  intent: BlogListingStatusIntent;
  row: StorefrontBlogListingStatusRow;
  categories?: string[];
}

export function evaluateBlogListingRequest(
  opts: EvaluateBlogListingRequestOptions
): StorefrontBlogListingStatusResolution {
  if (opts.intent.kind === 'author') {
    return resolveAuthor(opts.row, opts.intent.authorSlug, opts.intent.page);
  }
  if (!opts.row.blog_enabled) {
    return NOOP;
  }
  switch (opts.intent.kind) {
    case 'category-query':
      return resolveCategoryQuery(
        opts.intent.category,
        opts.categories ?? opts.row.categories,
        opts.identifier
      );
    case 'listing-page':
      return resolveListingPage(
        opts.row,
        opts.intent.page,
        opts.intent.category
      );
    case 'category-page':
      return resolveCategoryPage(
        opts.row,
        opts.intent.categorySlug,
        opts.intent.page
      );
    default:
      return NOOP;
  }
}

/**
 * Composes the hard-status verdict for a blog listing/category/author request
 * from the RPC's raw listing data, using the same TS helpers (and page size)
 * the routes render from. Only ever invoked for a published storefront (the
 * transport gates `storefront_status` first).
 *
 * The author branch owns its blog-disabled semantics (real 404, matching the
 * resolver's getCachedBlogAuthor); every other branch treats a disabled blog as
 * a NOOP, exactly as getCachedBlogListing returning null does.
 */
export function resolveBlogListingVerdict(
  intent: BlogListingStatusIntent,
  row: StorefrontBlogListingStatusRow,
  identifier?: string | null
): StorefrontBlogListingStatusResolution {
  return evaluateBlogListingRequest({
    intent,
    row,
    identifier,
  });
}
