import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchPublicSerializedAvailabilityCounts } from '@/lib/public-serialized-availability-counts';

type InventoryTrackingPolicy =
  | 'off'
  | 'serialized_strict'
  | 'serialized_then_unlimited';

export interface PublicSerializedVariantSummary {
  productId: string;
  variantId: string | null;
  publicAvailableUnits: number;
  inventoryTrackingPolicy: InventoryTrackingPolicy;
}

interface ProductInventoryPolicyRow {
  id: string;
  inventory_tracking_policy: string | null;
  has_variants: boolean | null;
  status: string | null;
}

interface ProductVariantInventoryPolicyRow {
  id: string;
  product_id: string;
  inventory_tracking_policy: string | null;
  is_inventory_anchor: boolean | null;
}

interface PublicSerializedAvailabilityCountRow {
  product_id: string;
  variant_id?: string | null;
  public_available_units: number;
}

function isPublicSerializedAvailabilityCountRow(
  value: unknown
): value is PublicSerializedAvailabilityCountRow {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const row = value as Record<string, unknown>;
  return (
    typeof row.product_id === 'string' &&
    (typeof row.variant_id === 'string' ||
      row.variant_id === null ||
      typeof row.variant_id === 'undefined') &&
    typeof row.public_available_units === 'number'
  );
}

function isSerializedInventoryPolicy(
  policy: string | null | undefined
): policy is Extract<
  InventoryTrackingPolicy,
  'serialized_strict' | 'serialized_then_unlimited'
> {
  return (
    policy === 'serialized_strict' || policy === 'serialized_then_unlimited'
  );
}

/**
 * Resolves the effective tracking policy for a variant based on the product policy and the variant policy.
 */
export function getEffectiveInventoryTrackingPolicy(
  productPolicy: string,
  variantPolicy?: string | null
): InventoryTrackingPolicy {
  if (
    variantPolicy === 'off' ||
    variantPolicy === 'serialized_strict' ||
    variantPolicy === 'serialized_then_unlimited'
  ) {
    return variantPolicy;
  }
  if (
    productPolicy === 'serialized_strict' ||
    productPolicy === 'serialized_then_unlimited'
  ) {
    return productPolicy as 'serialized_strict' | 'serialized_then_unlimited';
  }
  return 'off';
}

/**
 * Fetches the public-safe serialized variant summaries for a list of products.
 * Handles chunking in 200-item batches to comply with the database RPC limits.
 */
export async function getPublicSerializedVariantSummariesByProductId(
  supabase: SupabaseClient,
  merchantId: string,
  productIds: string[],
  branchId?: string
): Promise<PublicSerializedVariantSummary[]> {
  if (!productIds || productIds.length === 0) {
    return [];
  }

  // 1. Chunk product IDs in batches of at most 200
  const chunks: string[][] = [];
  for (let i = 0; i < productIds.length; i += 200) {
    chunks.push(productIds.slice(i, i + 200));
  }

  // 2. Fetch data in parallel for each chunk
  const results = await Promise.all(
    chunks.map(async (chunk) => {
      // Fetch products' tracking policies
      const { data: products, error: productsError } = await supabase
        .from('products')
        .select('id, inventory_tracking_policy, has_variants, status')
        .eq('merchant_id', merchantId)
        .in('id', chunk)
        .returns<ProductInventoryPolicyRow[]>();

      if (productsError) {
        throw productsError;
      }

      const activeProducts = (products || []).filter(
        (product) => product.status === 'active'
      );
      if (activeProducts.length === 0) {
        return [];
      }

      const activeProductIds = activeProducts.map((product) => product.id);

      // Fetch variants' tracking policies (including the anchor variant)
      const { data: variants, error: variantsError } = await supabase
        .from('product_variants')
        .select(
          'id, product_id, inventory_tracking_policy, is_inventory_anchor'
        )
        .eq('merchant_id', merchantId)
        .in('product_id', activeProductIds)
        .returns<ProductVariantInventoryPolicyRow[]>();

      if (variantsError) {
        throw variantsError;
      }

      // 3. Reconcile and resolve
      const summaries: PublicSerializedVariantSummary[] = [];

      // Create maps for fast lookup
      const productsMap = new Map(
        activeProducts.map((product) => [product.id, product])
      );
      const variantRows = variants || [];
      const variantsByProductMap = new Map<
        string,
        ProductVariantInventoryPolicyRow[]
      >();
      if (variantRows.length > 0) {
        for (const v of variantRows) {
          const list = variantsByProductMap.get(v.product_id) || [];
          list.push(v);
          variantsByProductMap.set(v.product_id, list);
        }
      }

      // Resolve for each product in the chunk
      for (const productId of chunk) {
        const product = productsMap.get(productId);
        if (!product) {
          continue;
        }

        const productVariants = variantsByProductMap.get(productId) || [];
        const productPolicy = product.inventory_tracking_policy ?? 'off';

        // Legacy/imported rows can have has_variants = null. Treat only an
        // explicit true as variant-based; null follows the simple-product path.
        if (product.has_variants === true) {
          // Variant-based product: resolve for each non-anchor variant
          for (const variant of productVariants) {
            if (variant.is_inventory_anchor) {
              continue; // Exclude anchor variant from public/storefront summaries
            }

            const effectivePolicy = getEffectiveInventoryTrackingPolicy(
              productPolicy,
              variant.inventory_tracking_policy
            );

            if (!isSerializedInventoryPolicy(effectivePolicy)) {
              continue;
            }

            summaries.push({
              productId,
              variantId: variant.id,
              publicAvailableUnits: 0,
              inventoryTrackingPolicy: effectivePolicy,
            });
          }
        } else {
          // Simple product: resolve for the anchor variant or product policy
          const anchorVariant = productVariants.find(
            (v) => v.is_inventory_anchor
          );
          const effectivePolicy = getEffectiveInventoryTrackingPolicy(
            productPolicy,
            anchorVariant?.inventory_tracking_policy
          );

          if (!isSerializedInventoryPolicy(effectivePolicy)) {
            continue;
          }

          summaries.push({
            productId,
            variantId: null, // Simple products expose null variantId in summaries
            publicAvailableUnits: 0,
            inventoryTrackingPolicy: effectivePolicy,
          });
        }
      }

      if (summaries.length === 0) {
        return summaries;
      }

      const serializedProductIds = Array.from(
        new Set(summaries.map((summary) => summary.productId))
      );

      // Most storefront lists are non-serialized; avoiding the count RPC for
      // those products keeps public HTML rendering out of Supabase timeouts.
      const rawCounts = await fetchPublicSerializedAvailabilityCounts(
        supabase,
        merchantId,
        serializedProductIds,
        branchId
      );

      const counts = Array.isArray(rawCounts)
        ? rawCounts.filter(isPublicSerializedAvailabilityCountRow)
        : [];

      const countsMap = new Map<string, number>(); // key: productId:variantId
      for (const c of counts) {
        const key = `${c.product_id}:${c.variant_id ?? 'null'}`;
        countsMap.set(key, c.public_available_units ?? 0);
      }

      return summaries.map((summary) => ({
        ...summary,
        publicAvailableUnits:
          countsMap.get(
            `${summary.productId}:${summary.variantId ?? 'null'}`
          ) ?? 0,
      }));
    })
  );

  // Use flatMap to avoid nested arrays
  return results.flat();
}
