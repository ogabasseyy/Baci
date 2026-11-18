import { revalidateProducts } from '@/lib/cache-revalidation';
import { expireProductBlogCache } from '@/lib/expire-product-blog-cache';

export interface RevalidateWithoutProductsInput {
  merchantId: string;
  hasProducts: boolean;
  purgeWholeStorefront?: boolean;
  hasExplicitProductSlugs: boolean;
  explicitSlugsRevalidated: boolean;
  callerOmitMerchantWidePdpDetails: boolean | undefined;
  shouldExpireProductBlogCache?: boolean;
}

/**
 * Handles origin cache invalidation for `/api/internal/revalidate-products`
 * calls that do not enter the `products`-enrichment branch (or need blog-mode
 * pre-expiry), returning `false` when required worker hard-expiry fails so the
 * caller can fail closed with 500 instead of confirming a stale edge purge.
 */
export function revalidateWithoutProducts({
  merchantId,
  hasProducts,
  purgeWholeStorefront = false,
  hasExplicitProductSlugs,
  explicitSlugsRevalidated,
  callerOmitMerchantWidePdpDetails,
  shouldExpireProductBlogCache = false,
}: RevalidateWithoutProductsInput): boolean {
  const isScopedSlugOnly =
    !hasProducts &&
    !purgeWholeStorefront &&
    callerOmitMerchantWidePdpDetails === true &&
    explicitSlugsRevalidated;

  if (isScopedSlugOnly) {
    const blogExpired = expireProductBlogCache(merchantId);
    const scopedExpired = revalidateProducts(merchantId, undefined, {
      expireImmediately: true,
      omitMerchantWidePdpDetails: true,
    });
    if (
      scopedExpired === false &&
      revalidateProducts(merchantId, undefined, { expireImmediately: true }) ===
        false
    ) {
      return false;
    }
    return !(shouldExpireProductBlogCache && blogExpired === false);
  }

  if (shouldExpireProductBlogCache) {
    const blogExpired = expireProductBlogCache(merchantId);
    if (blogExpired === false) {
      return false;
    }
    const needsBroadFallbackInBlogMode =
      callerOmitMerchantWidePdpDetails === false ||
      (!hasProducts &&
        (purgeWholeStorefront ||
          callerOmitMerchantWidePdpDetails === true ||
          (hasExplicitProductSlugs && !explicitSlugsRevalidated)));
    if (
      needsBroadFallbackInBlogMode &&
      revalidateProducts(merchantId, undefined, { expireImmediately: true }) ===
        false
    ) {
      return false;
    }
    return true;
  }

  if (!hasProducts || purgeWholeStorefront) {
    if (callerOmitMerchantWidePdpDetails === true) {
      return (
        revalidateProducts(merchantId, undefined, {
          expireImmediately: true,
        }) !== false
      );
    } else {
      revalidateProducts(merchantId);
    }
  }
  return true;
}
