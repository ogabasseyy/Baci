import { revalidateTag } from 'next/cache';
import { normalizeMerchantId } from '@/lib/normalize-merchant-id';

/**
 * Hard-expire product and related-blog cache entries before an edge purge.
 * Article enrichment embeds product availability, so stale-while-revalidate
 * could otherwise refill a purged document with the pre-mutation snapshot.
 */
export function expireProductBlogCache(merchantId: string): boolean {
  const normalizedMerchantId = normalizeMerchantId(merchantId);
  if (!normalizedMerchantId) return false;

  // Blog enrichment is keyed by the merchant's product tag. Avoid expiring
  // the route-critical blog core (which also carries the merchant identity
  // and currency tag) for routine product mutations. The broad product
  // revalidation helper also expires storefront indexes, redirects, feeds,
  // and dashboard caches, so callers keep that work on the durable purge
  // path instead.
  try {
    revalidateTag(`products-${normalizedMerchantId}`, { expire: 0 });
    return true;
  } catch {
    // Cache invalidation is best effort; callers still enqueue the durable
    // edge purge and the normal cache TTL provides a recovery path.
    return false;
  }
}
