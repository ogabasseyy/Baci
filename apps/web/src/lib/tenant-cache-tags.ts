import { createHash } from 'node:crypto';
import { getMerchantSlugCacheTag } from '@/lib/merchant-slug-cache-tag';
import { normalizeMerchantId } from '@/lib/normalize-merchant-id';
import { isSlugShapedIdentifier } from '@/lib/validation';

const MAX_CACHE_TAG_BYTES = 256;
const READABLE_OVERFLOW_PART_LENGTH = 48;
const HASH_SUFFIX_LENGTH = 32;

export const PLATFORM_SITEMAP_MERCHANTS_CACHE_TAG =
  'platform-sitemap-merchants';

function formatBoundedCacheTag(
  prefix: string,
  normalizedValue: string
): string {
  const rawTag = `${prefix}-${normalizedValue}`;
  if (
    rawTag.length <= MAX_CACHE_TAG_BYTES &&
    Buffer.byteLength(rawTag, 'utf8') <= MAX_CACHE_TAG_BYTES
  ) {
    return rawTag;
  }

  const readable =
    normalizedValue
      .replace(/[^a-z0-9.-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, READABLE_OVERFLOW_PART_LENGTH) || 'long';
  const digest = createHash('sha256')
    .update(normalizedValue)
    .digest('hex')
    .slice(0, HASH_SUFFIX_LENGTH);
  return `${prefix}-${readable}-${digest}`;
}

export function getBoundedMerchantSlugCacheTag(slug: string): string {
  const normalized = slug.trim().toLowerCase();
  const slugTag = getMerchantSlugCacheTag(normalized);
  if (
    slugTag.length <= MAX_CACHE_TAG_BYTES &&
    Buffer.byteLength(slugTag, 'utf8') <= MAX_CACHE_TAG_BYTES
  ) {
    return slugTag;
  }
  return formatBoundedCacheTag('merchant-slug', normalized);
}

export function getMerchantIdentifierCacheTag(identifier: string): string {
  return formatBoundedCacheTag('merchant', identifier.trim().toLowerCase());
}

export function getDomainCacheTag(domain: string): string {
  return formatBoundedCacheTag('domain', domain.trim().toLowerCase());
}

export interface ResolvedMerchantTagInput {
  id: string;
  slug: string;
  custom_domain?: string | null;
}

/**
 * Cache tags attached before a storefront merchant snapshot resolves an
 * identifier (slug or custom domain) to a merchant ID.
 */
export function buildStorefrontMerchantLookupTags(
  identifier: string
): string[] {
  const normalized = identifier.trim().toLowerCase();
  if (!normalized) {
    return [];
  }

  return [
    getMerchantIdentifierCacheTag(normalized),
    ...(isSlugShapedIdentifier(normalized)
      ? [getBoundedMerchantSlugCacheTag(normalized)]
      : []),
    getDomainCacheTag(normalized),
  ];
}

/**
 * Tenant- and domain-scoped cache tags attached once a merchant record has been
 * resolved, ensuring `revalidateMerchant`, `revalidateMerchantSlugLookup`, and
 * `revalidateDomains` can bust every cached entry for one tenant without
 * touching global tags.
 */
export function buildResolvedMerchantScopeTags({
  id,
  slug,
  custom_domain,
}: ResolvedMerchantTagInput): string[] {
  const tags = new Set<string>();
  const normalizedId = normalizeMerchantId(id);
  if (normalizedId) {
    tags.add(formatBoundedCacheTag('merchant-id', normalizedId));
    tags.add(formatBoundedCacheTag('features', normalizedId));
  }

  const normalizedSlug = slug.trim().toLowerCase();
  if (normalizedSlug) {
    tags.add(getMerchantIdentifierCacheTag(normalizedSlug));
    if (isSlugShapedIdentifier(normalizedSlug)) {
      tags.add(getBoundedMerchantSlugCacheTag(normalizedSlug));
    }
  }

  const normalizedDomain = custom_domain?.trim().toLowerCase();
  if (normalizedDomain) {
    tags.add(getDomainCacheTag(normalizedDomain));
    tags.add(getMerchantIdentifierCacheTag(normalizedDomain));
  }

  return Array.from(tags);
}

export function getBlogPostsMerchantCacheTag(merchantId: string): string {
  return formatBoundedCacheTag('blog-posts', merchantId.trim().toLowerCase());
}

export function getBlogCategoriesMerchantCacheTag(merchantId: string): string {
  return formatBoundedCacheTag(
    'blog-categories',
    merchantId.trim().toLowerCase()
  );
}

export function getBlogIdentifierCacheTag(identifier: string): string {
  return formatBoundedCacheTag(
    'blog-identifier',
    identifier.trim().toLowerCase()
  );
}

export function getBlogRssMerchantIdCacheTag(merchantId: string): string {
  return formatBoundedCacheTag('blog-rss-id', merchantId.trim().toLowerCase());
}

export function getBlogRssMerchantCacheTag(identifier: string): string {
  return formatBoundedCacheTag(
    'blog-rss-slug',
    identifier.trim().toLowerCase()
  );
}

export function getBlogListingStatusCacheTag(identifier: string): string {
  return formatBoundedCacheTag(
    'blog-listing-status',
    identifier.trim().toLowerCase()
  );
}

export function getBlogCategoryHubCacheTag(identifier: string): string {
  return formatBoundedCacheTag(
    'blog-category-hub',
    identifier.trim().toLowerCase()
  );
}

export function getPageConfigMerchantCacheTag(merchantId: string): string {
  return formatBoundedCacheTag('page-config', merchantId.trim().toLowerCase());
}

export function getPageConfigSlugCacheTag(
  merchantId: string,
  pageSlug: string
): string {
  return formatBoundedCacheTag(
    'page-config',
    `${merchantId.trim().toLowerCase()}-${pageSlug.trim()}`
  );
}
