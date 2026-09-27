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
  try {
    revalidateProducts(merchantId);

    // revalidateProducts() above busts only the merchant-wide/listing
    // tags. The bounded PDP snapshot is tagged
    // per-slug (getProductScopedCacheTag('product', merchantId, slug)),
    // which a bare revalidateProducts(merchantId) does NOT bust, so the
    // exact PDP a shopper is viewing could keep serving just-sold-out
    // stock for the full ~300s 'products' cacheLife. Callers carry
    // product_id but not slug, so resolve slugs with one merchant-scoped,
    // PK-indexed lookup and bust the per-slug PDP tags too.
    const revalidateProductIds = Array.from(
      new Set(productIds.filter((id): id is string => Boolean(id)))
    );
    if (revalidateProductIds.length > 0) {
      const { data: revalidateProductRows, error: revalidateSlugError } =
        await supabase
          .from('products')
          .select('slug')
          .eq('merchant_id', merchantId)
          .in('id', revalidateProductIds)
          .returns<Array<{ slug: string }>>();
      if (revalidateSlugError) {
        logger.error({
          message: 'Failed to resolve product slugs for PDP cache revalidation',
          error: revalidateSlugError,
          orderId,
          merchantId,
        });
      } else if (revalidateProductRows) {
        revalidateProductSlugs(
          merchantId,
          revalidateProductRows.map((row) => row.slug)
        );
      }
    }
  } catch (revalidateError) {
    logger.error({
      message: 'Failed to revalidate product caches after order creation',
      error: revalidateError,
      orderId,
      merchantId,
    });
  }
}
