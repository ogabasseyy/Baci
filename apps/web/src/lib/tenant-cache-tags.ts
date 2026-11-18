import { getMerchantSlugCacheTag } from '@/lib/merchant-slug-cache-tag';
import { normalizeMerchantId } from '@/lib/normalize-merchant-id';
import { isSlugShapedIdentifier } from '@/lib/validation';

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
    `merchant-${normalized}`,
    ...(isSlugShapedIdentifier(normalized)
      ? [getMerchantSlugCacheTag(normalized)]
      : []),
    `domain-${normalized}`,
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
    tags.add(`merchant-id-${normalizedId}`);
    tags.add(`features-${normalizedId}`);
  }

  const normalizedSlug = slug.trim().toLowerCase();
  if (normalizedSlug) {
    tags.add(`merchant-${normalizedSlug}`);
    if (isSlugShapedIdentifier(normalizedSlug)) {
      tags.add(getMerchantSlugCacheTag(normalizedSlug));
    }
  }

  const normalizedDomain = custom_domain?.trim().toLowerCase();
  if (normalizedDomain) {
    tags.add(`domain-${normalizedDomain}`);
    tags.add(`merchant-${normalizedDomain}`);
  }

  return Array.from(tags);
}

export function getBlogPostsMerchantCacheTag(merchantId: string): string {
  return `blog-posts-${merchantId.trim()}`;
}

export function getBlogCategoriesMerchantCacheTag(merchantId: string): string {
  return `blog-categories-${merchantId.trim()}`;
}

export function getBlogIdentifierCacheTag(identifier: string): string {
  return `blog-identifier-${identifier.trim().toLowerCase()}`;
}

export function getBlogRssMerchantCacheTag(
  identifierOrMerchantId: string
): string {
  return `blog-rss-${identifierOrMerchantId.trim().toLowerCase()}`;
}

export function getBlogListingStatusCacheTag(identifier: string): string {
  return `blog-listing-status-${identifier.trim().toLowerCase()}`;
}

export function getBlogCategoryHubCacheTag(identifier: string): string {
  return `blog-category-hub-${identifier.trim().toLowerCase()}`;
}

export function getPageConfigMerchantCacheTag(merchantId: string): string {
  return `page-config-${merchantId.trim()}`;
}

export function getPageConfigSlugCacheTag(
  merchantId: string,
  pageSlug: string
): string {
  return `page-config-${merchantId.trim()}-${pageSlug.trim()}`;
}
