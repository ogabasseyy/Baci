/**
 * On-Demand Cache Revalidation Utilities
 *
 * Provides helper functions to invalidate cached data when mutations occur.
 * Uses Next.js 16 revalidateTag() to bust 'use cache' entries.
 *
 * The second argument to revalidateTag() is the cacheLife profile name —
 * it tells Next.js to serve stale data during background revalidation
 * using the timing from that profile.
 *
 * Usage: Call the appropriate function after a successful DB mutation in API routes.
 */
import { revalidatePath, revalidateTag } from 'next/cache';
import { after } from 'next/server';
import { getBlogCacheTag } from '@/lib/blog-cache-tags';
import { getBlogContentLinksCacheTag } from '@/lib/blog-content-link-cache-tags';

export { revalidateCategories } from '@/lib/revalidate-categories';

import { purgeCloudflareUrls } from '@/lib/cloudflare-purge';
import { buildMerchantPublicationDataCacheTags } from '@/lib/merchant-publication-data-cache-tags';
import { normalizeMerchantId } from '@/lib/normalize-merchant-id';
import {
  getPlatformBlogPostCacheTag,
  PLATFORM_BLOG_CACHE_TAG,
  PLATFORM_BLOG_FEED_CACHE_TAG,
  PLATFORM_BLOG_LIST_CACHE_TAG,
  PLATFORM_BLOG_SITEMAP_CACHE_TAG,
} from '@/lib/platform-blog';
import { productCacheRevalidation } from '@/lib/product-cache-revalidation';
import { generateSlug } from '@/lib/seo-utils';
import { buildStorefrontBlogPurgeUrls } from '@/lib/storefront-purge-urls';

export const revalidateMerchantFeed =
  productCacheRevalidation.revalidateMerchantFeed;
export const revalidateProductSlugs =
  productCacheRevalidation.revalidateProductSlugs;
export const revalidateProducts = productCacheRevalidation.revalidateProducts;

interface BlogRevalidationOptions {
  identifiers?: Array<string | null | undefined>;
  canonicalMerchantSlug?: string | null | undefined;
  listingCategories?: Array<string | null | undefined>;
  listingPages?: Array<number | null | undefined>;
  merchantId?: string | null | undefined;
  postSlugs?: Array<string | null | undefined>;
}

const CANONICAL_MERCHANT_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isSafeCanonicalMerchantSlug(slug: string): boolean {
  return CANONICAL_MERCHANT_SLUG_PATTERN.test(slug);
}

/**
 * Evict the given canonical URLs from Cloudflare's edge cache. Fire-and-forget:
 * uses `after()` when a request context exists (so the purge runs even after the
 * response is flushed) and falls back to a detached promise in cron/worker
 * contexts. `purgeCloudflareUrls` never throws, so this never affects the caller.
 */
function schedulePurgeCloudflareUrls(urls: string[]): void {
  if (urls.length === 0) {
    return;
  }

  try {
    after(() => purgeCloudflareUrls(urls));
  } catch {
    // Not inside a request scope (standalone worker / test) — detach instead.
    void purgeCloudflareUrls(urls);
  }
}

/**
 * Revalidate all cached data related to a merchant store.
 * Call after ordinary merchant settings updates. Publication transitions must
 * use `revalidateMerchantPublication` because stale-while-revalidate is unsafe
 * for storefront availability state.
 */
export function revalidateMerchant(merchantId: string, merchantSlug?: string) {
  revalidateTag('merchants', 'merchant');
  revalidateTag(`merchant-id-${merchantId}`, 'merchant');

  if (merchantSlug) {
    revalidateTag(`merchant-${merchantSlug}`, 'merchant');
  }

  // Dashboard stats may change
  revalidateTag(`dashboard-${merchantId}`, 'merchant');
}

/**
 * Hard-expire merchant-scoped publication data before the caller evicts cached
 * storefront documents at the outer CDN. Publication is an availability
 * boundary, so the normal stale-while-revalidate profile is unsafe here.
 */
export function revalidateMerchantPublication({
  merchantId,
  canonicalMerchantSlug,
  identifiers,
}: {
  merchantId: string;
  canonicalMerchantSlug: string | null | undefined;
  identifiers: readonly (string | null | undefined)[];
}): void {
  const normalizedMerchantId = normalizeMerchantId(merchantId);
  if (!normalizedMerchantId) {
    console.warn(
      'Skipped publication cache revalidation for invalid merchant ID',
      { merchantId }
    );
    throw new Error('Invalid merchant ID for publication cache revalidation');
  }

  const immediateExpiry = { expire: 0 } as const;
  for (const tag of buildMerchantPublicationDataCacheTags({
    canonicalMerchantSlug,
    identifiers,
    merchantId: normalizedMerchantId,
  })) {
    revalidateTag(tag, immediateExpiry);
  }
  revalidateTag(`dashboard-${normalizedMerchantId}`, 'merchant');
}

/**
 * Bust EVERY per-slug merchant cache for a specific slug:
 *   - `merchant-slug-${slug}` + 'merchant' — the /api/merchants/by-slug route
 *   - `merchant-${slug}` + 'merchants' — getCachedMerchant() in lib/cached-data.ts
 * None of these are cleared by revalidateMerchant() for a slug OTHER than the one
 * passed to it. Call this for BOTH the old and the new slug after a rename so the
 * retired slug stops resolving to a live store and the new slug serves at once,
 * instead of staying cached for up to 5 minutes.
 */
export function revalidateMerchantSlugLookup(slug: string) {
  revalidateTag('merchant', 'merchant');
  revalidateTag(`merchant-slug-${slug}`, 'merchant');
  revalidateTag(`merchant-${slug}`, 'merchant');
}

/**
 * Bust the `/api/storefront/[slug]/products` merchant-id lookup cache. That route's
 * `getMerchantIdBySlug` caches results (a MISS included) under the generic
 * 'merchant-slug' tag for 60s, and the tag is not per-slug, so
 * `revalidateMerchantSlugLookup` (which targets `merchant-slug-${slug}`) can't
 * clear it. After a rename, a pre-rename probe of the NEW slug would otherwise
 * 404 the renamed store's products API until the cached miss expires. Call once
 * per rename (the tag is shared across all slugs).
 */
export function revalidateStorefrontProductsSlugCache() {
  revalidateTag('merchant-slug', 'merchant');
}

/**
 * Bust the blog RSS feed cache (`/api/blog/feed/[merchantSlug]`). It caches the
 * merchant + posts payload by merchant id under the generic 'blog-rss-feed' /
 * 'blog-posts' tags for an hour and EMBEDS the slug in the feed's storeUrl/feedUrl.
 * After a rename, both the old-alias URL and the new-slug URL resolve to the same
 * cached object and keep emitting the retired slug until the TTL — so bust it on
 * rename. Tags are not per-merchant, so call once.
 */
export function revalidateBlogFeed() {
  revalidateTag('blog-rss-feed', 'merchant');
  revalidateTag('blog-posts', 'merchant');
}

/**
 * Revalidate blog post cache.
 * Call after blog post create/update/delete/publish.
 */
export function revalidateBlogPosts(
  identifierOrOptions: string | BlogRevalidationOptions,
  postSlug?: string
) {
  const identifiers =
    typeof identifierOrOptions === 'string'
      ? [identifierOrOptions]
      : (identifierOrOptions.identifiers ?? []);
  const postSlugs =
    typeof identifierOrOptions === 'string'
      ? [postSlug]
      : (identifierOrOptions.postSlugs ?? []);
  const listingCategories =
    typeof identifierOrOptions === 'string'
      ? []
      : (identifierOrOptions.listingCategories ?? []);
  const listingPages =
    typeof identifierOrOptions === 'string'
      ? []
      : (identifierOrOptions.listingPages ?? []);
  const canonicalMerchantSlug =
    typeof identifierOrOptions === 'string'
      ? null
      : (identifierOrOptions.canonicalMerchantSlug ?? null);
  const merchantId =
    typeof identifierOrOptions === 'string'
      ? ''
      : (identifierOrOptions.merchantId?.trim() ?? '');

  const normalizedIdentifiers = Array.from(
    new Set(
      identifiers
        .map((identifier) => identifier?.trim().toLowerCase())
        .filter((identifier): identifier is string => Boolean(identifier))
    )
  );
  const normalizedPostSlugs = Array.from(
    new Set(
      postSlugs
        .map((slug) => slug?.trim().toLowerCase())
        .filter((slug): slug is string => Boolean(slug))
    )
  );
  const normalizedListingCategories = Array.from(
    new Set([
      'all',
      ...listingCategories
        .map((category) => category?.trim())
        .filter((category): category is string => Boolean(category)),
    ])
  );
  const normalizedListingPages = Array.from(
    new Set(
      listingPages.filter(
        (page): page is number =>
          typeof page === 'number' && Number.isInteger(page) && page > 0
      )
    )
  );
  const effectiveListingPages =
    normalizedListingPages.length > 0 ? normalizedListingPages : [1];
  const rawCanonicalMerchantSlug =
    canonicalMerchantSlug?.trim().toLowerCase() || '';
  const normalizedCanonicalMerchantSlug = isSafeCanonicalMerchantSlug(
    rawCanonicalMerchantSlug
  )
    ? rawCanonicalMerchantSlug
    : '';

  if (normalizedIdentifiers.length > 0 || rawCanonicalMerchantSlug.length > 0) {
    // RSS cache entries use coarse shared tags by design. The merchant-scoped
    // feed path below narrows the route cache refresh for the canonical slug.
    revalidateTag('blog-rss-feed', 'merchant');
    revalidateTag('blog-posts', 'merchant');
    revalidateTag(
      merchantId
        ? getBlogContentLinksCacheTag(merchantId)
        : 'blog-content-links',
      'merchant'
    );
  }

  if (
    rawCanonicalMerchantSlug.length > 0 &&
    normalizedCanonicalMerchantSlug.length === 0
  ) {
    console.warn('Skipped blog feed path revalidation for invalid slug', {
      canonicalMerchantSlug: rawCanonicalMerchantSlug,
    });
  }

  if (normalizedCanonicalMerchantSlug.length > 0) {
    revalidatePath(`/api/blog/feed/${normalizedCanonicalMerchantSlug}`);
  }

  for (const identifier of normalizedIdentifiers) {
    revalidatePath(`/${identifier}/blog`);
    revalidatePath(`/${identifier}/blog/news-sitemap.xml`);
    revalidatePath(`/${identifier}/blog/sitemap.xml`);

    for (const category of normalizedListingCategories) {
      for (const page of effectiveListingPages) {
        revalidateTag(
          `blog-list-${identifier}-${category}-${page}`,
          'merchant'
        );
      }
    }

    for (const slug of normalizedPostSlugs) {
      revalidateTag(getBlogCacheTag(identifier, slug), 'merchant');
      revalidatePath(`/${identifier}/blog/${slug}`);
      revalidatePath(`/${identifier}/blog/${slug}/opengraph-image`);
    }
  }

  // Evict the Cloudflare-fronted public blog URLs so the raised edge TTL never
  // serves a stale post/listing. No-op for storefronts without a cache policy.
  const purgeIdentifiers = Array.from(
    new Set(
      [...normalizedIdentifiers, normalizedCanonicalMerchantSlug].filter(
        (identifier): identifier is string => identifier.length > 0
      )
    )
  );
  // Derive the category listing slugs to evict from the affected category
  // labels. The public category route is /blog/category/<slug> where the slug
  // is generateSlug(label) (getBlogCategorySlug), so slugify here to match the
  // actually-cached URL. The 'all' sentinel used for the blog-list cache tags
  // is intentionally excluded: its listing is /blog, already purged above.
  const purgeCategorySlugs = Array.from(
    new Set(
      listingCategories
        .map((category) => (category ? generateSlug(category) : ''))
        .filter((categorySlug): categorySlug is string => Boolean(categorySlug))
    )
  );
  // `buildStorefrontBlogPurgeUrls` runs OUTSIDE the never-throw purge helper, so
  // guard the build + schedule sequence: a Cloudflare purge is always survivable
  // (caches self-heal on their TTL), and it must never break the Next-tag/path
  // revalidation that already ran above.
  try {
    schedulePurgeCloudflareUrls(
      buildStorefrontBlogPurgeUrls(
        purgeIdentifiers,
        normalizedPostSlugs,
        purgeCategorySlugs
      )
    );
  } catch (error) {
    console.warn('Skipped Cloudflare blog purge scheduling', { error });
  }
}

export function revalidatePlatformBlog(slug?: string) {
  revalidateTag(PLATFORM_BLOG_CACHE_TAG, 'merchant');
  revalidateTag(PLATFORM_BLOG_LIST_CACHE_TAG, 'merchant');
  revalidateTag(PLATFORM_BLOG_SITEMAP_CACHE_TAG, 'merchant');
  revalidateTag(PLATFORM_BLOG_FEED_CACHE_TAG, 'merchant');

  const normalizedSlug = slug?.trim().toLowerCase();
  if (normalizedSlug) {
    revalidateTag(getPlatformBlogPostCacheTag(normalizedSlug), 'merchant');
    revalidatePath(`/blog/${normalizedSlug}`);
    revalidatePath(`/blog/${normalizedSlug}/opengraph-image`);
  }

  revalidatePath('/blog');
  revalidatePath('/blog/feed.xml');
  revalidatePath('/sitemap.xml');
}

/**
 * Revalidate product review cache.
 * Call after review create/update/approve/delete.
 */
export function revalidateReviews(productId: string) {
  revalidateTag(`reviews-${productId}`, 'products');
  revalidateTag(`rating-stats-${productId}`, 'products');
}

/**
 * Revalidate merchant feature settings cache.
 * Call after feature toggle changes.
 */
export function revalidateFeatures(merchantId: string) {
  revalidateTag(`features-${merchantId}`, 'merchant');
}

/**
 * Revalidate page builder config cache.
 * Call after page config publish.
 */
export function revalidatePageConfig(merchantId: string, pageSlug?: string) {
  revalidateTag('page-config', 'storefront-page');

  if (pageSlug) {
    revalidateTag(`page-config-${merchantId}-${pageSlug}`, 'storefront-page');
  }
}

/**
 * Revalidate the repairs catalog feeds (Facebook repairs XML + agent-repairs
 * JSONL) for a merchant. Call after any repairs catalog mutation — device,
 * quote, or service-type CRUD, and AI import commit — so the machine-readable
 * feeds never serve a stale quote/device/service-type.
 *
 * The tags mirror `getCachedRepairsFeedData`'s
 * (`REPAIRS_FEED_CACHE_TAG`, `getRepairsFeedMerchantCacheTag(merchantId)`).
 *
 * @param merchantId - Canonical merchant UUID (not slug).
 */
export function revalidateRepairsCatalog(merchantId: string) {
  const normalizedMerchantId = normalizeMerchantId(merchantId);
  if (!normalizedMerchantId) {
    console.warn(
      'Skipped repairs catalog cache revalidation for invalid merchant ID',
      { merchantId }
    );
    return;
  }

  revalidateTag('repairs-catalog-feed', 'products');
  revalidateTag(`repairs-feed-${normalizedMerchantId}`, 'products');
}

/**
 * Revalidate domain-related caches.
 * Call after custom domain add/remove/verify.
 */
export function revalidateDomains(domain?: string) {
  revalidateTag('domains', 'merchant');

  if (domain) {
    revalidateTag(`domain-${domain.toLowerCase()}`, 'merchant');
  }
}

/**
 * Revalidate cached platform analytics data.
 * Call after platform-level analytics views are refreshed.
 */
export function revalidateAnalytics() {
  revalidateTag('analytics', 'products');
}
