import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  revalidateProductSlugs,
  revalidateProducts,
} from '@/lib/cache-revalidation';
import { logger } from '@/lib/logger';

/**
 * Best-effort storefront product cache revalidation after an order reserves
 * inventory. create_storefront_order* decrements product_variants/products
 * stock inside the RPC (for every order — paid, POD, or unpaid), so the
 * merchant's storefront product caches are busted immediately instead of
 * after the ~300s 'products' cacheLife. Never throws: a revalidation failure
 * must never turn a successful order into an error response.
 */
export async function revalidateOrderProductCaches({
  merchantId,
  orderId,
  productIds,
  supabase,
}: {
  merchantId: string;
  orderId: string | null;
  productIds: readonly (string | null | undefined)[];
  supabase: SupabaseClient;
}): Promise<void> {
  let didRevalidateProducts = false;
  try {
    // Resolve product IDs -> slugs FIRST so a single-product order busts only
    // the ordered product's PDP + listing/feed/dashboard tags instead of
    // wiping all unrelated cached PDPs via `product-details-${merchantId}`.
    // Fall back to full `revalidateProducts(merchantId)` if any ID fails to
    // resolve or the lookup errors.
    const revalidateProductIds = Array.from(
      new Set(
        productIds
          .map((id) => id?.trim())
          .filter((id): id is string => Boolean(id))
      )
    );
    if (revalidateProductIds.length === 0) {
      revalidateProducts(merchantId);
      didRevalidateProducts = true;
      return;
    }

    const { data: revalidateProductRows, error: revalidateSlugError } =
      await supabase
        .from('products')
        .select('slug')
        .eq('merchant_id', merchantId)
        .in('id', revalidateProductIds)
        .returns<Array<{ slug: string | null }>>();
    if (revalidateSlugError) {
      logger.error({
        message: 'Failed to resolve product slugs for PDP cache revalidation',
        error: revalidateSlugError,
        orderId,
        merchantId,
      });
      revalidateProducts(merchantId);
      didRevalidateProducts = true;
      return;
    }

    const resolvedSlugs = (revalidateProductRows ?? [])
      .map((row) => row.slug?.trim())
      .filter((slug): slug is string => Boolean(slug));
    const slugsRevalidated =
      resolvedSlugs.length > 0 &&
      revalidateProductSlugs(merchantId, resolvedSlugs) === true;

    if (
      slugsRevalidated &&
      resolvedSlugs.length === revalidateProductIds.length
    ) {
      revalidateProducts(merchantId, undefined, {
        omitMerchantWidePdpDetails: true,
      });
    } else {
      revalidateProducts(merchantId);
    }
    didRevalidateProducts = true;
  } catch (revalidateError) {
    logger.error({
      message: 'Failed to revalidate product caches after order creation',
      error: revalidateError,
      orderId,
      merchantId,
    });
    if (!didRevalidateProducts) {
      try {
        revalidateProducts(merchantId);
      } catch {
        // Best-effort fallback: never fail order completion if cache revalidation throws.
      }
    }
  }
}
