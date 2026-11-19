import { revalidateProducts } from '@/lib/cache-revalidation';
import { expireProductBlogCache } from '@/lib/expire-product-blog-cache';
import { logger } from '@/lib/logger';

interface HardExpireOriginCachesInput {
  merchantId: string;
  scopedOptions?: { omitMerchantWidePdpDetails?: boolean };
  edgePurgeTarget: 'product' | 'hostname';
}

/**
 * Hard-expire blog enrichment and merchant product tags before an edge purge
 * so a subsequent Cloudflare MISS cannot refill origin cache with stale data.
 */
export function hardExpireOriginCaches({
  merchantId,
  scopedOptions,
  edgePurgeTarget,
}: HardExpireOriginCachesInput): boolean {
  const blogExpired = expireProductBlogCache(merchantId) !== false;
  let productsExpired =
    revalidateProducts(merchantId, undefined, {
      expireImmediately: true,
      ...scopedOptions,
    }) !== false;
  if (!productsExpired && scopedOptions) {
    productsExpired =
      revalidateProducts(merchantId, undefined, {
        expireImmediately: true,
      }) !== false;
  }
  if (!blogExpired || !productsExpired) {
    logger.error({
      message: `Failed to hard-expire origin caches before edge ${edgePurgeTarget} purge`,
      merchantId,
      blogExpired,
      productsExpired,
    });
    return false;
  }
  return true;
}
