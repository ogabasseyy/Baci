import type { SupabaseClient } from '@supabase/supabase-js';
import {
  revalidateProductSlugs,
  revalidateProducts,
} from '@/lib/cache-revalidation';
import { isInventoryTrackedProduct } from '@/lib/is-inventory-tracked-product';
import { logger } from '@/lib/logger';
import { scheduleOrderProductBlogPurgeAfterResponse } from '@/lib/schedule-order-product-blog-purge-after-response';

type CheckoutOrderItem = {
  product_id?: string | null;
  variant_id?: string | null;
};

type ProductPolicyRow = {
  id: string;
  inventory_tracking_policy: string | null;
  manage_stock: boolean | null;
  slug: string;
};

type VariantPolicyRow = {
  inventory_tracking_policy: string | null;
  product_id: string;
};

/** Invalidates checkout-affected PDPs and linked blog rails after the RPC. */
export async function scheduleCheckoutProductBlogPurge({
  merchantId,
  merchantSlug,
  orderId,
  orderItems,
  supabase,
}: {
  merchantId: string;
  merchantSlug: string;
  orderId: string;
  orderItems: readonly CheckoutOrderItem[];
  supabase: SupabaseClient;
}): Promise<void> {
  revalidateProducts(merchantId);

  const productIds = Array.from(
    new Set(
      orderItems
        .map((item) => item.product_id?.trim())
        .filter((id): id is string => Boolean(id))
    )
  );
  if (productIds.length === 0) return;

  const { data: productRows, error: productLookupError } = await supabase
    .from('products')
    .select('id, slug, manage_stock, inventory_tracking_policy')
    .eq('merchant_id', merchantId)
    .in('id', productIds)
    .returns<ProductPolicyRow[]>();

  if (productLookupError) {
    scheduleOrderProductBlogPurgeAfterResponse({
      merchantId,
      merchantSlug,
      productIds,
      supabase,
    });
    logger.error({
      message: 'Failed to resolve product slugs for PDP cache revalidation',
      error: productLookupError,
      orderId,
      merchantId,
    });
    return;
  }

  const resolvedProductRows = productRows ?? [];
  revalidateProductSlugs(
    merchantId,
    resolvedProductRows.map((row) => row.slug)
  );

  const resolvedProductIds = new Set(
    resolvedProductRows.map((product) => product.id)
  );
  const productsNeedingVariantLookup = new Set(
    resolvedProductRows
      .filter((product) => !isInventoryTrackedProduct(product))
      .map((product) => product.id)
  );
  const variantIds = Array.from(
    new Set(
      orderItems
        .filter(
          (item) =>
            typeof item.product_id === 'string' &&
            productsNeedingVariantLookup.has(item.product_id.trim())
        )
        .map((item) => item.variant_id?.trim())
        .filter((id): id is string => Boolean(id))
    )
  );
  const serializedVariantProductIds = new Set<string>();
  let variantPolicyLookupFailed = false;

  if (variantIds.length > 0) {
    const { data: variantRows, error: variantLookupError } = await supabase
      .from('product_variants')
      .select('product_id, inventory_tracking_policy')
      .eq('merchant_id', merchantId)
      .in('id', variantIds)
      .returns<VariantPolicyRow[]>();

    if (variantLookupError) {
      variantPolicyLookupFailed = true;
      logger.error({
        message:
          'Failed to resolve variant inventory policies after order creation',
        error: variantLookupError,
        orderId,
        merchantId,
      });
    } else {
      for (const variant of variantRows ?? []) {
        if (
          isInventoryTrackedProduct(
            { id: variant.product_id, manage_stock: false },
            [variant]
          )
        ) {
          serializedVariantProductIds.add(variant.product_id);
        }
      }
    }
  }

  const trackedProductIds = resolvedProductRows
    .filter((product) =>
      isInventoryTrackedProduct(product, [
        ...(serializedVariantProductIds.has(product.id)
          ? [
              {
                product_id: product.id,
                inventory_tracking_policy: 'serialized_strict',
              },
            ]
          : []),
      ])
    )
    .map((product) => product.id);
  const unresolvedProductIds = productIds.filter(
    (productId) =>
      !resolvedProductIds.has(productId) ||
      (variantPolicyLookupFailed && productsNeedingVariantLookup.has(productId))
  );
  const productIdsForBlogPurge = Array.from(
    new Set([...trackedProductIds, ...unresolvedProductIds])
  );

  if (productIdsForBlogPurge.length === 0) return;

  // Article enrichment can require several paginated reads. Keep it on the
  // request's post-response queue so checkout latency remains bounded.
  scheduleOrderProductBlogPurgeAfterResponse({
    merchantId,
    merchantSlug,
    productIds: productIdsForBlogPurge,
    supabase,
  });
}
