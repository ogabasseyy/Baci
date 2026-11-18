import { getBlogCacheTag } from '@/lib/blog-cache-tags';
import { getBlogContentLinksCacheTag } from '@/lib/blog-content-link-cache-tags';
import { normalizeMerchantId } from '@/lib/normalize-merchant-id';
import { generateSlug } from '@/lib/seo-utils';
import {
  getBlogCategoriesMerchantCacheTag,
  getBlogCategoryHubCacheTag,
  getBlogIdentifierCacheTag,
  getBlogListingStatusCacheTag,
  getBlogPostsMerchantCacheTag,
  getBlogRssMerchantCacheTag,
  getBlogRssMerchantIdCacheTag,
} from '@/lib/tenant-cache-tags';

export interface BlogRevalidationOptions {
  /** Storefront slug and active custom domains; required alongside `canonicalMerchantSlug` for Next path revalidation and Cloudflare edge purges. */
  identifiers?: Array<string | null | undefined>;
  /** Merchant canonical slug used to compute `/api/blog/feed/<slug>` path and `blog-rss-slug-*` edge tag invalidation. */
  canonicalMerchantSlug?: string | null | undefined;
  listingCategories?: Array<string | null | undefined>;
  listingPages?: Array<number | null | undefined>;
  merchantId?: string | null | undefined;
  postSlugs?: Array<string | null | undefined>;
}

export interface BlogRevalidationPlan {
  tags: string[];
  paths: string[];
  purgeIdentifiers: string[];
  normalizedPostSlugs: string[];
  purgeCategorySlugs: string[];
  invalidCanonicalMerchantSlug: string | null;
}

const CANONICAL_MERCHANT_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isSafeCanonicalMerchantSlug(slug: string): boolean {
  return CANONICAL_MERCHANT_SLUG_PATTERN.test(slug);
}

/**
 * Compute Next.js cache tags, paths, and Cloudflare purge inputs for a blog
 * mutation. Emits only tenant/identifier-scoped tags when `merchantId` is set,
 * falling back to global `'blog-posts'` / `'blog-rss-feed'` only for legacy
 * identifier-only callers; `{}` is a no-op.
 *
 * `merchantId`-only calls bust origin `'use cache'` tags (`blog-posts-*`,
 * `blog-categories-*`, `blog-content-links-*`, `blog-rss-id-*`) and skip
 * `revalidatePath`, `blog-listing-status-*`, and Cloudflare URL purges.
 * Mutations that must also evict CDN/rendered blog URLs — post create, update,
 * publish/unpublish, scheduled publish, delete, reservation release, and blog
 * cache APIs — MUST pass `identifiers` and `canonicalMerchantSlug`.
 */
export function buildBlogRevalidationPlan(
  identifierOrOptions: string | BlogRevalidationOptions,
  postSlug?: string
): BlogRevalidationPlan {
  const isStringArg = typeof identifierOrOptions === 'string';
  const rawIdentifiers = isStringArg
    ? [identifierOrOptions]
    : (identifierOrOptions.identifiers ?? []);
  const rawPostSlugs = isStringArg
    ? [postSlug]
    : (identifierOrOptions.postSlugs ?? []);
  const listingCategories = isStringArg
    ? []
    : (identifierOrOptions.listingCategories ?? []);
  const listingPages = isStringArg
    ? []
    : (identifierOrOptions.listingPages ?? []);
  const canonicalMerchantSlug = isStringArg
    ? null
    : (identifierOrOptions.canonicalMerchantSlug ?? null);
  const merchantId = isStringArg
    ? ''
    : (normalizeMerchantId(identifierOrOptions.merchantId) ?? '');

  const normalizedIdentifiers = Array.from(
    new Set(
      rawIdentifiers
        .map((identifier) => identifier?.trim().toLowerCase())
        .filter((identifier): identifier is string => Boolean(identifier))
    )
  );
  const normalizedPostSlugs = Array.from(
    new Set(
      rawPostSlugs
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
  const invalidCanonicalMerchantSlug =
    rawCanonicalMerchantSlug.length > 0 &&
    normalizedCanonicalMerchantSlug.length === 0
      ? rawCanonicalMerchantSlug
      : null;

  const tags = new Set<string>();
  const paths = new Set<string>();

  const hasScope =
    merchantId.length > 0 ||
    normalizedIdentifiers.length > 0 ||
    rawCanonicalMerchantSlug.length > 0;

  if (hasScope) {
    if (merchantId) {
      const normalizedMerchantIdLower = merchantId.toLowerCase();
      tags.add(getBlogPostsMerchantCacheTag(normalizedMerchantIdLower));
      tags.add(getBlogCategoriesMerchantCacheTag(normalizedMerchantIdLower));
      tags.add(getBlogContentLinksCacheTag(normalizedMerchantIdLower));
      tags.add(getBlogRssMerchantIdCacheTag(normalizedMerchantIdLower));
    } else {
      // Legacy callers without a merchantId cannot compute merchant-ID-keyed
      // tags (e.g. getCachedBlogPostEnrichment, getCachedFeedByMerchantId), so
      // retain the broad fallback tags in that case only.
      tags.add('blog-rss-feed');
      tags.add('blog-posts');
      tags.add('blog-content-links');
    }

    if (normalizedCanonicalMerchantSlug.length > 0) {
      tags.add(getBlogRssMerchantCacheTag(normalizedCanonicalMerchantSlug));
      paths.add(`/api/blog/feed/${normalizedCanonicalMerchantSlug}`);
    }

    for (const identifier of normalizedIdentifiers) {
      tags.add(getBlogIdentifierCacheTag(identifier));
      tags.add(getBlogRssMerchantCacheTag(identifier));
      tags.add(getBlogListingStatusCacheTag(identifier));
      tags.add(getBlogCategoryHubCacheTag(identifier));

      paths.add(`/${identifier}/blog`);
      paths.add(`/${identifier}/blog/news-sitemap.xml`);
      paths.add(`/${identifier}/blog/sitemap.xml`);

      for (const category of normalizedListingCategories) {
        for (const page of effectiveListingPages) {
          tags.add(`blog-list-${identifier}-${category}-${page}`);
        }
      }

      for (const slug of normalizedPostSlugs) {
        tags.add(getBlogCacheTag(identifier, slug));
        paths.add(`/${identifier}/blog/${slug}`);
        paths.add(`/${identifier}/blog/${slug}/opengraph-image`);
      }
    }
  }

  const purgeIdentifiers = Array.from(
    new Set(
      [...normalizedIdentifiers, normalizedCanonicalMerchantSlug].filter(
        (identifier): identifier is string => identifier.length > 0
      )
    )
  );
  const purgeCategorySlugs = Array.from(
    new Set(
      listingCategories
        .map((category) => (category ? generateSlug(category) : ''))
        .filter((categorySlug): categorySlug is string => Boolean(categorySlug))
    )
  );

  return {
    tags: Array.from(tags),
    paths: Array.from(paths),
    purgeIdentifiers,
    normalizedPostSlugs,
    purgeCategorySlugs,
    invalidCanonicalMerchantSlug,
  };
}
