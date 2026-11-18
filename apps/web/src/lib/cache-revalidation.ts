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

export { revalidateCategories } from '@/lib/revalidate-categories';

import {
  type BlogRevalidationOptions,
  buildBlogRevalidationPlan,
} from '@/lib/blog-revalidation-plan';
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
import { buildStorefrontBlogPurgeUrls } from '@/lib/storefront-purge-urls';
import {
  getBlogRssMerchantCacheTag,
  getBoundedMerchantSlugCacheTag,
  getDomainCacheTag,
  getMerchantIdentifierCacheTag,
  getPageConfigMerchantCacheTag,
  getPageConfigSlugCacheTag,
  PLATFORM_SITEMAP_MERCHANTS_CACHE_TAG,
} from '@/lib/tenant-cache-tags';
import { isDomainIdentifier, isSlugShapedIdentifier } from '@/lib/validation';

export const revalidateMerchantFeed =
  productCacheRevalidation.revalidateMerchantFeed;
export const revalidateProductSlugs =
  productCacheRevalidation.revalidateProductSlugs;
export const revalidateProducts = productCacheRevalidation.revalidateProducts;

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
 * Revalidate tenant-scoped cached data for a merchant store.
 * Call after ordinary merchant settings updates. Publication transitions must
 * use `revalidateMerchantPublication` because stale-while-revalidate is unsafe
 * for storefront availability state.
 */
export function revalidateMerchant(merchantId: string, merchantSlug?: string) {
  const normalizedMerchantId = normalizeMerchantId(merchantId);
  if (!normalizedMerchantId) {
    console.warn(
      'Skipped merchant cache revalidation for invalid merchant ID',
      { merchantId }
    );
    return;
  }

  revalidateTag(`merchant-id-${normalizedMerchantId}`, 'merchant');

  const normalizedSlug = merchantSlug?.trim().toLowerCase();
  if (normalizedSlug) {
    revalidateTag(getMerchantIdentifierCacheTag(normalizedSlug), 'merchant');
    if (isSlugShapedIdentifier(normalizedSlug)) {
      revalidateTag(getBoundedMerchantSlugCacheTag(normalizedSlug), 'merchant');
    }
  }

  // Dashboard stats may change
  revalidateTag(`dashboard-${normalizedMerchantId}`, 'merchant');
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
  revalidateTag(PLATFORM_SITEMAP_MERCHANTS_CACHE_TAG, immediateExpiry);
  revalidatePath('/sitemap.xml');
  revalidateTag(`dashboard-${normalizedMerchantId}`, 'merchant');
}

/**
 * Bust per-slug merchant caches for a specific slug:
 *   - `merchant-slug-${slug}` + 'merchant' — the /api/merchants/by-slug route
 *   - `merchant-${slug}` + 'merchant' — getCachedMerchant() in lib/cached-data.ts
 *   - `platform-sitemap-merchants` + `/sitemap.xml` — root sitemap discovery
 * Call this for BOTH the old and the new slug after a rename so the retired slug
 * stops resolving to a live store and the new slug serves at once. Only falls
 * back to the global `'merchant'` tag when `slug` is omitted or empty.
 */
export function revalidateMerchantSlugLookup(slug?: string) {
  if (slug == null || slug.trim() === '') {
    revalidateTag('merchant', 'merchant');
    revalidateTag(PLATFORM_SITEMAP_MERCHANTS_CACHE_TAG, 'merchant');
    revalidatePath('/sitemap.xml');
    return;
  }

  const normalizedIdentifier = slug.trim().toLowerCase();
  const lookupTag = isSlugShapedIdentifier(normalizedIdentifier)
    ? getBoundedMerchantSlugCacheTag(normalizedIdentifier)
    : isDomainIdentifier(normalizedIdentifier)
      ? getDomainCacheTag(normalizedIdentifier)
      : null;

  if (lookupTag) {
    revalidateTag(lookupTag, 'merchant');
    revalidateTag(
      getMerchantIdentifierCacheTag(normalizedIdentifier),
      'merchant'
    );
    revalidateTag(getBlogRssMerchantCacheTag(normalizedIdentifier), 'merchant');
    revalidateTag(PLATFORM_SITEMAP_MERCHANTS_CACHE_TAG, 'merchant');
    revalidatePath(`/api/blog/feed/${normalizedIdentifier}`);
    revalidatePath('/sitemap.xml');
    return;
  }

  console.warn('Skipped merchant slug lookup revalidation for invalid slug', {
    slug,
  });
}

/**
 * Bust the `/api/storefront/[slug]/products` merchant-id lookup cache.
 */
export function revalidateStorefrontProductsSlugCache() {
  revalidateTag('merchant-slug', 'merchant');
}

/**
 * Bust the blog RSS feed cache (`/api/blog/feed/[merchantSlug]`).
 */
export function revalidateBlogFeed() {
  revalidateTag('blog-rss-feed', 'merchant');
  revalidateTag('blog-posts', 'merchant');
}

/**
 * Revalidate blog post cache. Callers on storefront blog mutations (create,
 * update, publish, delete, reservation release) MUST pass `identifiers` and
 * `canonicalMerchantSlug`; `merchantId`-only invalidates origin tags only.
 */
export function revalidateBlogPosts(
  identifierOrOptions: string | BlogRevalidationOptions,
  postSlug?: string
) {
  const plan = buildBlogRevalidationPlan(identifierOrOptions, postSlug);

  if (plan.invalidCanonicalMerchantSlug) {
    console.warn('Skipped blog feed path revalidation for invalid slug', {
      canonicalMerchantSlug: plan.invalidCanonicalMerchantSlug,
    });
  }

  for (const tag of plan.tags) {
    revalidateTag(tag, 'merchant');
  }
  for (const path of plan.paths) {
    revalidatePath(path);
  }

  // `buildStorefrontBlogPurgeUrls` runs OUTSIDE the never-throw purge helper, so
  // guard the build + schedule sequence: a Cloudflare purge is always survivable
  // (caches self-heal on their TTL), and it must never break the Next-tag/path
  // revalidation that already ran above.
  try {
    schedulePurgeCloudflareUrls(
      buildStorefrontBlogPurgeUrls(
        plan.purgeIdentifiers,
        plan.normalizedPostSlugs,
        plan.purgeCategorySlugs
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
 * Revalidate page builder config cache for a single merchant.
 * Call after page config publish. Note: `apps/web/src` currently queries
 * `page_configs` directly without `use cache` / `next.tags` readers, so
 * tenant-scoped tags prevent cross-tenant global invalidation while remaining
 * ready for any per-merchant `page-config-${merchantId}` reader.
 */
export function revalidatePageConfig(merchantId: string, pageSlug?: string) {
  const normalizedMerchantId = normalizeMerchantId(merchantId);
  if (!normalizedMerchantId) {
    console.warn(
      'Skipped page config cache revalidation for invalid merchant ID',
      { merchantId }
    );
    return;
  }

  revalidateTag(
    getPageConfigMerchantCacheTag(normalizedMerchantId),
    'storefront-page'
  );

  const normalizedPageSlug = pageSlug?.trim();
  if (normalizedPageSlug) {
    revalidateTag(
      getPageConfigSlugCacheTag(normalizedMerchantId, normalizedPageSlug),
      'storefront-page'
    );
  }
}

/**
 * Revalidate the repairs catalog feeds (Facebook repairs XML + agent-repairs
 * JSONL) for a merchant without touching unrelated tenants.
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

  revalidateTag(`repairs-feed-${normalizedMerchantId}`, 'products');
}

/**
 * Revalidate domain-related caches.
 * Busts only the targeted domain/merchant tags when a domain is provided;
 * falls back to the global `'domains'` tag only when omitted/empty.
 */
export function revalidateDomains(domain?: string) {
  const normalizedDomain =
    typeof domain === 'string' ? domain.trim().toLowerCase() : '';

  if (!normalizedDomain) {
    revalidateTag('domains', 'merchant');
    return;
  }

  revalidateTag(getDomainCacheTag(normalizedDomain), 'merchant');
  revalidateTag(getMerchantIdentifierCacheTag(normalizedDomain), 'merchant');
}

/**
 * Revalidate cached platform analytics data.
 * Call after platform-level analytics views are refreshed.
 */
export function revalidateAnalytics() {
  revalidateTag('analytics', 'products');
}
