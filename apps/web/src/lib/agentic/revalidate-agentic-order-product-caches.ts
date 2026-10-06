import type { SupabaseClient } from '@supabase/supabase-js';
import { isInventoryTrackedProduct } from '@/lib/is-inventory-tracked-product';
import { logger } from '@/lib/logger';
import { productCacheRevalidation } from '@/lib/product-cache-revalidation';
import { sanitizeForLog } from '@/lib/sanitize-core';
import { scheduleOrderProductBlogPurgeAfterResponse } from '@/lib/schedule-order-product-blog-purge-after-response';

interface ProductCacheRow {
  id: string;
  inventory_tracking_policy: string | null;
  manage_stock: boolean | null;
  slug: string;
}

interface ProductVariantCacheRow {
  inventory_tracking_policy: string | null;
  product_id: string;
}

interface RevalidateAgenticOrderProductCachesInput {
  merchantId: string;
  productIds: readonly (string | null | undefined)[];
  sessionId: string;
  slugLookupFailureMessage: string;
  outerFailureMessage: string;
  supabase: SupabaseClient;
}

/** Revalidates sold-product caches while keeping article enrichment post-response. */
export async function revalidateAgenticOrderProductCaches({
  merchantId,
  productIds,
  sessionId,
  slugLookupFailureMessage,
  outerFailureMessage,
  supabase,
}: RevalidateAgenticOrderProductCachesInput): Promise<void> {
  try {
    const normalizedProductIds = Array.from(
      new Set(
        productIds
          .filter(
            (id): id is string => typeof id === 'string' && id.trim().length > 0
          )
          .map((id) => id.trim())
      )
    );
    if (normalizedProductIds.length === 0) {
      return;
    }

    try {
      const { data: products, error } = await supabase
        .from('products')
        .select('id, slug, manage_stock, inventory_tracking_policy')
        .in('id', normalizedProductIds)
        .eq('merchant_id', merchantId)
        .returns<ProductCacheRow[]>();

      if (error) {
        scheduleOrderProductBlogPurgeAfterResponse({
          merchantId,
          productIds: normalizedProductIds,
          supabase,
        });
        productCacheRevalidation.revalidateProducts(merchantId, undefined, {
          feedScope: 'merchant',
        });
        logger.error({
          error: sanitizeForLog(error),
          message: slugLookupFailureMessage,
          sessionId: sanitizeForLog(sessionId),
        });
        return;
      }

      const variantsByProductId = new Map<string, ProductVariantCacheRow[]>();
      const productsNeedingVariantLookup = (products ?? []).filter(
        (product) => !isInventoryTrackedProduct(product)
      );
      let variantPolicyLookupFailed = false;
      if (productsNeedingVariantLookup.length > 0) {
        const { data: variants, error: variantsError } = await supabase
          .from('product_variants')
          .select('product_id, inventory_tracking_policy')
          .eq('merchant_id', merchantId)
          .in(
            'product_id',
            productsNeedingVariantLookup.map((product) => product.id)
          )
          .returns<ProductVariantCacheRow[]>();
        if (variantsError) {
          variantPolicyLookupFailed = true;
          // Child policy is an optimization for serialized inventory; a
          // failed projection must not suppress invalidation for managed
          // parent products whose policy remains authoritative.
          logger.error({
            error: sanitizeForLog(variantsError),
            message: slugLookupFailureMessage,
            sessionId: sanitizeForLog(sessionId),
          });
        } else {
          for (const variant of variants ?? []) {
            const productVariants =
              variantsByProductId.get(variant.product_id) ?? [];
            productVariants.push(variant);
            variantsByProductId.set(variant.product_id, productVariants);
          }
        }
      }

      const trackedProducts = (products ?? []).filter((product) =>
        variantPolicyLookupFailed &&
        productsNeedingVariantLookup.some(
          (candidate) => candidate.id === product.id
        )
          ? true
          : isInventoryTrackedProduct(
              product,
              variantsByProductId.get(product.id) ?? []
            )
      );
      if (trackedProducts.length > 0) {
        // Article rails change only when inventory-tracked products mutate.
        // Unlimited-stock sales still refresh dashboard state, but do not
        // enqueue an unnecessary relationship lookup and CDN purge.
        scheduleOrderProductBlogPurgeAfterResponse({
          merchantId,
          productIds: trackedProducts.map((product) => product.id),
          supabase,
        });
        productCacheRevalidation.revalidateProducts(merchantId, undefined, {
          feedScope: 'merchant',
        });
        productCacheRevalidation.revalidateProductSlugs(
          merchantId,
          trackedProducts.map((product) => product.slug)
        );
      } else {
        productCacheRevalidation.revalidateDashboard(merchantId);
      }
    } catch (error) {
      scheduleOrderProductBlogPurgeAfterResponse({
        merchantId,
        productIds: normalizedProductIds,
        supabase,
      });
      logger.error({
        error: sanitizeForLog(error),
        message: slugLookupFailureMessage,
        sessionId: sanitizeForLog(sessionId),
      });
    }
  } catch (error) {
    logger.error({
      error: sanitizeForLog(error),
      message: outerFailureMessage,
      sessionId: sanitizeForLog(sessionId),
    });
  }
}
