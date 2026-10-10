import type { SupabaseClient } from '@supabase/supabase-js';
import { sanitizePublicProduct } from '@/lib/public-fulfillment-sanitizer';
import {
  getPublicSerializedVariantSummariesByProductId,
  type PublicSerializedVariantSummary,
} from '@/lib/public-serialized-variant-summary';

export const SERIALIZED_THEN_UNLIMITED_STOCK_QUANTITY = 9999;

type PublicVariantRecord = { id: string; [key: string]: unknown };

function hydratePublicSerializedVariants(
  variants: PublicVariantRecord[],
  productSummaries: PublicSerializedVariantSummary[]
): PublicVariantRecord[] {
  const summariesByVariantId = new Map(
    productSummaries
      .filter((summary) => summary.variantId !== null)
      .map((summary) => [summary.variantId, summary])
  );

  return variants.map((variant) => {
    const variantSummary = summariesByVariantId.get(variant.id);
    if (!variantSummary) return variant;

    const updatedVariant = { ...variant };
    updatedVariant.inventory_tracking_policy =
      variantSummary.inventoryTrackingPolicy;
    updatedVariant.stock_quantity = variantSummary.publicAvailableUnits;

    if (
      variantSummary.inventoryTrackingPolicy === 'serialized_then_unlimited' &&
      variantSummary.publicAvailableUnits === 0
    ) {
      updatedVariant.stock_quantity = SERIALIZED_THEN_UNLIMITED_STOCK_QUANTITY;
    }

    return updatedVariant;
  });
}

export async function hydrateAndSanitizePublicProducts<
  T extends { id: string },
>(supabase: SupabaseClient, merchantId: string, products: T[]): Promise<T[]> {
  if (products.length === 0) return [];

  const summaries = await getPublicSerializedVariantSummariesByProductId(
    supabase,
    merchantId,
    products.map((product) => product.id)
  );
  const summariesByProduct = new Map<
    string,
    PublicSerializedVariantSummary[]
  >();
  for (const summary of summaries) {
    const productSummaries = summariesByProduct.get(summary.productId) || [];
    productSummaries.push(summary);
    summariesByProduct.set(summary.productId, productSummaries);
  }

  const hydrated = products.map((product) => {
    const productSummaries = summariesByProduct.get(product.id) || [];
    if (productSummaries.length === 0) return product;

    const updatedProduct = { ...product } as Record<string, unknown>;
    const productSummary = productSummaries.find(
      (summary) => summary.variantId === null
    );
    if (productSummary) {
      const resolvedUnits =
        productSummary.inventoryTrackingPolicy ===
          'serialized_then_unlimited' &&
        productSummary.publicAvailableUnits === 0
          ? SERIALIZED_THEN_UNLIMITED_STOCK_QUANTITY
          : productSummary.publicAvailableUnits;

      updatedProduct.inventory_tracking_policy =
        productSummary.inventoryTrackingPolicy;
      updatedProduct.quantity = resolvedUnits;
      updatedProduct.stock_quantity = resolvedUnits;
      updatedProduct.stock = resolvedUnits;
      if (productSummary.inventoryTrackingPolicy === 'serialized_strict') {
        updatedProduct.track_quantity = true;
        updatedProduct.manage_stock = true;
      } else if (
        productSummary.inventoryTrackingPolicy === 'serialized_then_unlimited'
      ) {
        updatedProduct.track_quantity = false;
        updatedProduct.manage_stock = false;
      }
    }

    for (const key of ['product_variants', 'variants'] as const) {
      if (Array.isArray(updatedProduct[key])) {
        updatedProduct[key] = hydratePublicSerializedVariants(
          updatedProduct[key] as PublicVariantRecord[],
          productSummaries
        );
      }
    }
    return updatedProduct as T;
  });

  return hydrated.map(sanitizePublicProduct);
}
