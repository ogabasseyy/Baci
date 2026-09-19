import type { SupabaseClient } from '@supabase/supabase-js';
import { isInventoryTrackedProduct } from '@/lib/is-inventory-tracked-product';
import { logger } from '@/lib/logger';

type CustomerCancellationOrderItem = {
  product_id?: unknown;
  variant_id?: unknown;
};

type ProductPolicyRow = {
  id?: unknown;
  inventory_tracking_policy?: unknown;
  manage_stock?: unknown;
  slug?: unknown;
};

type VariantPolicyRow = {
  inventory_tracking_policy?: string | null;
  product_id?: string | null;
};

export type TrackedCustomerCancellationProduct = {
  id: string;
  slug: string | null;
};

/** Resolves only products whose cancellation can change public availability. */
export async function getTrackedCustomerCancellationProducts({
  merchantId,
  orderItems,
  productIds,
  supabase,
}: {
  merchantId: string;
  orderItems: readonly CustomerCancellationOrderItem[];
  productIds: readonly string[];
  supabase: SupabaseClient;
}): Promise<TrackedCustomerCancellationProduct[]> {
  let productRows: ProductPolicyRow[];
  try {
    const { data, error } = await supabase
      .from('products')
      .select('id, slug, manage_stock, inventory_tracking_policy')
      .eq('merchant_id', merchantId)
      .in('id', productIds);
    if (error) throw error;
    productRows = (data ?? []).map((row) => row as ProductPolicyRow);
  } catch (error) {
    logger.error({
      message: 'Failed to resolve product slugs after customer cancellation',
      merchantId,
      error,
    });
    // The cancellation RPC has already committed the restock. Preserve every
    // validated candidate so the caller still performs merchant-wide and
    // article invalidation even when the follow-up policy projection is down.
    return Array.from(
      new Set(productIds.map((productId) => productId.trim()).filter(Boolean))
    ).map((id) => ({ id, slug: null }));
  }

  const productsNeedingVariantLookup = new Set(
    productRows
      .filter((product) => {
        const id = product.id;
        return (
          typeof id === 'string' &&
          !isInventoryTrackedProduct({
            id,
            inventory_tracking_policy:
              typeof product.inventory_tracking_policy === 'string'
                ? product.inventory_tracking_policy
                : null,
            manage_stock:
              typeof product.manage_stock === 'boolean'
                ? product.manage_stock
                : null,
          })
        );
      })
      .map((product) => product.id)
      .filter((id): id is string => typeof id === 'string')
  );
  const variantIds = Array.from(
    new Set(
      orderItems
        .filter((item) => {
          const productId = item.product_id;
          return (
            typeof productId === 'string' &&
            productsNeedingVariantLookup.has(productId.trim())
          );
        })
        .map((item) => item.variant_id)
        .filter(
          (variantId): variantId is string =>
            typeof variantId === 'string' && variantId.trim().length > 0
        )
        .map((variantId) => variantId.trim())
    )
  );
  const variantsByProductId = new Map<string, VariantPolicyRow[]>();
  let variantPolicyLookupFailed = false;

  if (variantIds.length > 0) {
    try {
      const { data: variantRows, error: variantRowsError } = await supabase
        .from('product_variants')
        .select('product_id, inventory_tracking_policy')
        .eq('merchant_id', merchantId)
        .in('id', variantIds);
      if (variantRowsError) {
        variantPolicyLookupFailed = true;
        // Child policy is an optimization; a failed projection must not
        // suppress invalidation for a managed parent whose policy remains
        // authoritative.
        logger.error({
          message:
            'Failed to resolve variant inventory policies after customer cancellation',
          merchantId,
          error: variantRowsError,
        });
      } else {
        for (const row of variantRows ?? []) {
          const variant: VariantPolicyRow = {
            product_id:
              typeof row.product_id === 'string' ? row.product_id : null,
            inventory_tracking_policy:
              typeof row.inventory_tracking_policy === 'string'
                ? row.inventory_tracking_policy
                : null,
          };
          if (!variant.product_id) continue;
          const variants = variantsByProductId.get(variant.product_id) ?? [];
          variants.push(variant);
          variantsByProductId.set(variant.product_id, variants);
        }
      }
    } catch (error) {
      variantPolicyLookupFailed = true;
      logger.error({
        message:
          'Failed to resolve variant inventory policies after customer cancellation',
        merchantId,
        error,
      });
    }
  }

  return productRows
    .filter(
      (product): product is ProductPolicyRow & { id: string } =>
        typeof product.id === 'string' &&
        (variantPolicyLookupFailed &&
        productsNeedingVariantLookup.has(product.id)
          ? true
          : isInventoryTrackedProduct(
              {
                id: product.id,
                inventory_tracking_policy:
                  typeof product.inventory_tracking_policy === 'string'
                    ? product.inventory_tracking_policy
                    : null,
                manage_stock:
                  typeof product.manage_stock === 'boolean'
                    ? product.manage_stock
                    : null,
              },
              variantsByProductId.get(product.id) ?? []
            ))
    )
    .map((product) => ({
      id: product.id,
      slug: typeof product.slug === 'string' ? product.slug : null,
    }));
}
