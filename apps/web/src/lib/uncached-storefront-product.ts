import { sanitizePublicProduct } from './public-fulfillment-sanitizer';
import { normalizeCachedStorefrontPdpCore } from './storefront-pdp-core-normalizer';
import { readStorefrontPdpCoreSnapshot } from './storefront-pdp-core-snapshot';
import { getStorefrontSnapshotSupabaseClient } from './storefront-pdp-snapshot-client';
import {
  StorefrontReadUnavailableError,
  unwrapStorefrontReadResultForCache,
} from './storefront-read-result';

/**
 * Reads the bounded merchant-scoped PDP snapshot without using Next's product
 * cache while preserving the shared normalization and public-field sanitation.
 */
export async function getUncachedProductWithDetails(
  merchantId: string,
  productSlug: string
) {
  const snapshot = unwrapStorefrontReadResultForCache(
    await readStorefrontPdpCoreSnapshot(getStorefrontSnapshotSupabaseClient(), {
      merchantId,
      productSlug,
    })
  );
  if (snapshot?.kind !== 'product') return null;

  const product = normalizeCachedStorefrontPdpCore(
    snapshot.product as Record<string, unknown>
  );
  if (!product) {
    throw new StorefrontReadUnavailableError({
      kind: 'integrity',
      operation: 'pdp_core_snapshot',
      retryable: false,
    });
  }
  return sanitizePublicProduct(product);
}
