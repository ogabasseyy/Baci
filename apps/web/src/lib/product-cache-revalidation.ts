import { revalidateTag } from 'next/cache';
import { getCategoryPageDataCacheTag } from '@/lib/category-page-cache-tags';
import { logger } from '@/lib/logger';
import { normalizeMerchantId } from '@/lib/normalize-merchant-id';
import {
  getProductScopedCacheTag,
  getProductSlugSetCacheTag,
} from '@/lib/product-cache-tags';
import { sanitizeForLog } from '@/lib/sanitize-core';
import { buildStorefrontProductsCacheTags } from '@/lib/storefront-products-cache-key';

export interface ProductRevalidationOptions {
  expireImmediately?: boolean;
  feedScope?: 'all' | 'merchant' | 'none';
}

type ProductCacheProfile = string | { readonly expire: 0 };

function resolveProfile(
  profile: string,
  options: ProductRevalidationOptions
): ProductCacheProfile {
  return options.expireImmediately ? { expire: 0 } : profile;
}

type ProductTagRevalidationOutcome = 'ok' | 'missing_context' | 'failed';

interface ProductTagEntry {
  readonly profile: ProductCacheProfile;
  readonly tag: string;
}

function isMissingNextCacheContextError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '';
  return (
    message.includes('static generation store missing') ||
    message.includes('incrementalCache') ||
    message.includes('missing Next request context')
  );
}

function revalidateProductTag(
  tag: string,
  profile: ProductCacheProfile
): ProductTagRevalidationOutcome {
  try {
    revalidateTag(tag, profile);
    return 'ok';
  } catch (error) {
    if (isMissingNextCacheContextError(error)) {
      return 'missing_context';
    }
    logger.error({
      error: sanitizeForLog(error),
      message: 'Failed to revalidate product cache tag',
      tag: sanitizeForLog(tag),
    });
    return 'failed';
  }
}

function revalidateProductTagBatch(
  entries: readonly ProductTagEntry[]
): boolean {
  let allRevalidated = true;
  for (const { tag, profile } of entries) {
    const outcome = revalidateProductTag(tag, profile);
    if (outcome === 'missing_context') {
      return false;
    }
    if (outcome !== 'ok') {
      allRevalidated = false;
    }
  }
  return allRevalidated;
}

function getMerchantFeedTagEntries(
  normalizedMerchantId: string,
  options: ProductRevalidationOptions
): ProductTagEntry[] {
  const profile = resolveProfile('products', options);
  return [
    { profile, tag: 'google-merchant-feed' },
    { profile, tag: 'openai-product-feed' },
    { profile, tag: `merchant-feed-${normalizedMerchantId}` },
    { profile, tag: `merchant-feed-review-signals-${normalizedMerchantId}` },
  ];
}

function revalidateMerchantFeed(
  merchantId: string,
  options: ProductRevalidationOptions = {}
): boolean {
  const normalizedMerchantId = normalizeMerchantId(merchantId);
  if (!normalizedMerchantId) {
    logger.warn({
      merchantId: sanitizeForLog(merchantId),
      message: 'Skipped merchant feed revalidation for invalid merchant ID',
    });
    return false;
  }

  return revalidateProductTagBatch(
    getMerchantFeedTagEntries(normalizedMerchantId, options)
  );
}

function revalidateDashboard(merchantId: string): boolean {
  const normalizedMerchantId = normalizeMerchantId(merchantId);
  if (!normalizedMerchantId) {
    logger.warn({
      merchantId: sanitizeForLog(merchantId),
      message: 'Skipped dashboard cache revalidation for invalid merchant ID',
    });
    return false;
  }

  return (
    revalidateProductTag(`dashboard-${normalizedMerchantId}`, 'merchant') ===
    'ok'
  );
}

function revalidateProducts(
  merchantId: string,
  productSlug?: string,
  options: ProductRevalidationOptions = {}
): boolean {
  const normalizedMerchantId = normalizeMerchantId(merchantId);
  if (!normalizedMerchantId) {
    logger.warn({
      merchantId: sanitizeForLog(merchantId),
      message: 'Skipped product cache revalidation for invalid merchant ID',
    });
    return false;
  }

  const productsProfile = resolveProfile('products', options);
  const storefrontProfile = resolveProfile('storefront-page', options);
  const merchantProfile = resolveProfile('merchant', options);

  const entries: ProductTagEntry[] = [
    { profile: productsProfile, tag: `products-${normalizedMerchantId}` },
    ...buildStorefrontProductsCacheTags(normalizedMerchantId).map((tag) => ({
      profile: productsProfile,
      tag,
    })),
  ];

  const normalizedProductSlug = productSlug?.trim();
  if (normalizedProductSlug) {
    entries.push({
      profile: productsProfile,
      tag: getProductScopedCacheTag(
        'product',
        normalizedMerchantId,
        normalizedProductSlug
      ),
    });
  }

  entries.push(
    { profile: productsProfile, tag: 'product-details' },
    {
      profile: storefrontProfile,
      tag: getCategoryPageDataCacheTag(normalizedMerchantId),
    },
    {
      profile: productsProfile,
      tag: `product-index-${normalizedMerchantId}`,
    },
    {
      profile: productsProfile,
      tag: getProductSlugSetCacheTag(normalizedMerchantId),
    },
    { profile: productsProfile, tag: 'product-canonical-redirect' },
    { profile: productsProfile, tag: 'product-legacy-redirect' }
  );

  const feedScope = options.feedScope ?? 'all';
  if (feedScope === 'all') {
    entries.push(...getMerchantFeedTagEntries(normalizedMerchantId, options));
  } else if (feedScope === 'merchant') {
    // The merchant-scoped tag is sufficient to evict this merchant's Google
    // and OpenAI feed entries without churning every merchant's feed cache.
    entries.push({
      profile: productsProfile,
      tag: `merchant-feed-${normalizedMerchantId}`,
    });
  }

  entries.push({
    profile: merchantProfile,
    tag: `dashboard-${normalizedMerchantId}`,
  });

  return revalidateProductTagBatch(entries);
}

function revalidateProductSlugs(
  merchantId: string,
  slugs: readonly (string | null | undefined)[],
  options: ProductRevalidationOptions = {}
): boolean {
  const normalizedMerchantId = normalizeMerchantId(merchantId);
  if (!normalizedMerchantId) {
    logger.warn({
      merchantId: sanitizeForLog(merchantId),
      message: 'Skipped product slug revalidation for invalid merchant ID',
    });
    return false;
  }

  // Callers that evict the Cloudflare edge immediately after this returns
  // must pass `expireImmediately`: stale-while-revalidate would serve the
  // pre-mutation PDP snapshot to the first post-purge request and re-seed
  // the edge with stale stock.
  const profile = resolveProfile('products', options);
  const seen = new Set<string>();
  const entries: ProductTagEntry[] = [];
  for (const rawSlug of slugs) {
    const slug = rawSlug?.trim();
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    entries.push({
      profile,
      tag: getProductScopedCacheTag('product', normalizedMerchantId, slug),
    });
  }

  return revalidateProductTagBatch(entries);
}

export const productCacheRevalidation = {
  revalidateDashboard,
  revalidateMerchantFeed,
  revalidateProductSlugs,
  revalidateProducts,
} as const;
