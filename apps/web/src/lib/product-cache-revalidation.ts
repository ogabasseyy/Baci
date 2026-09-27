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

function revalidateProductTag(
  tag: string,
  profile: ProductCacheProfile
): boolean {
  try {
    revalidateTag(tag, profile);
    return true;
  } catch (error) {
    logger.error({
      error: sanitizeForLog(error),
      message: 'Failed to revalidate product cache tag',
      tag: sanitizeForLog(tag),
    });
    return false;
  }
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

  return [
    revalidateProductTag(
      'google-merchant-feed',
      resolveProfile('products', options)
    ),
    revalidateProductTag(
      'openai-product-feed',
      resolveProfile('products', options)
    ),
    revalidateProductTag(
      `merchant-feed-${normalizedMerchantId}`,
      resolveProfile('products', options)
    ),
    revalidateProductTag(
      `merchant-feed-review-signals-${normalizedMerchantId}`,
      resolveProfile('products', options)
    ),
  ].every(Boolean);
}

function revalidateDashboard(merchantId: string): void {
  const normalizedMerchantId = normalizeMerchantId(merchantId);
  if (!normalizedMerchantId) {
    logger.warn({
      merchantId: sanitizeForLog(merchantId),
      message: 'Skipped dashboard cache revalidation for invalid merchant ID',
    });
    return;
  }

  revalidateProductTag(`dashboard-${normalizedMerchantId}`, 'merchant');
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

  const results = [
    revalidateProductTag(
      `products-${normalizedMerchantId}`,
      resolveProfile('products', options)
    ),
  ];
  for (const tag of buildStorefrontProductsCacheTags(normalizedMerchantId)) {
    results.push(
      revalidateProductTag(tag, resolveProfile('products', options))
    );
  }
  const normalizedProductSlug = productSlug?.trim();
  if (normalizedProductSlug) {
    results.push(
      revalidateProductTag(
        getProductScopedCacheTag(
          'product',
          normalizedMerchantId,
          normalizedProductSlug
        ),
        resolveProfile('products', options)
      )
    );
  }
  results.push(
    revalidateProductTag('product-details', resolveProfile('products', options))
  );
  results.push(
    revalidateProductTag(
      getCategoryPageDataCacheTag(normalizedMerchantId),
      resolveProfile('storefront-page', options)
    )
  );
  results.push(
    revalidateProductTag(
      `product-index-${normalizedMerchantId}`,
      resolveProfile('products', options)
    )
  );
  results.push(
    revalidateProductTag(
      getProductSlugSetCacheTag(normalizedMerchantId),
      resolveProfile('products', options)
    )
  );
  results.push(
    revalidateProductTag(
      'product-canonical-redirect',
      resolveProfile('products', options)
    )
  );
  results.push(
    revalidateProductTag(
      'product-legacy-redirect',
      resolveProfile('products', options)
    )
  );
  const feedScope = options.feedScope ?? 'all';
  if (feedScope === 'all') {
    results.push(revalidateMerchantFeed(normalizedMerchantId, options));
  } else if (feedScope === 'merchant') {
    // The merchant-scoped tag is sufficient to evict this merchant's Google
    // and OpenAI feed entries without churning every merchant's feed cache.
    results.push(
      revalidateProductTag(
        `merchant-feed-${normalizedMerchantId}`,
        resolveProfile('products', options)
      )
    );
  }
  results.push(
    revalidateProductTag(
      `dashboard-${normalizedMerchantId}`,
      resolveProfile('merchant', options)
    )
  );
  return results.every(Boolean);
}

function revalidateProductSlugs(
  merchantId: string,
  slugs: readonly (string | null | undefined)[],
  options: ProductRevalidationOptions = {}
): void {
  const normalizedMerchantId = normalizeMerchantId(merchantId);
  if (!normalizedMerchantId) {
    logger.warn({
      merchantId: sanitizeForLog(merchantId),
      message: 'Skipped product slug revalidation for invalid merchant ID',
    });
    return;
  }

  // Callers that evict the Cloudflare edge immediately after this returns
  // must pass `expireImmediately`: stale-while-revalidate would serve the
  // pre-mutation PDP snapshot to the first post-purge request and re-seed
  // the edge with stale stock.
  const profile = resolveProfile('products', options);
  const seen = new Set<string>();
  for (const rawSlug of slugs) {
    const slug = rawSlug?.trim();
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    revalidateProductTag(
      getProductScopedCacheTag('product', normalizedMerchantId, slug),
      profile
    );
  }
}

export const productCacheRevalidation = {
  revalidateDashboard,
  revalidateMerchantFeed,
  revalidateProductSlugs,
  revalidateProducts,
} as const;
