import type { SupabaseClient } from '@supabase/supabase-js';
import { hydrateAndSanitizePublicProducts } from '@/lib/hydrate-public-products';
import { isPublicVariantPurchasable } from '@/lib/is-public-variant-purchasable';
import type { RelatedBlogProduct } from '@/lib/related-blog-products';

const SERIALIZED_INVENTORY_POLICIES = new Set([
  'serialized_strict',
  'serialized_then_unlimited',
]);

function hasSerializedInventory(product: RelatedBlogProduct): boolean {
  if (
    SERIALIZED_INVENTORY_POLICIES.has(product.inventory_tracking_policy ?? '')
  ) {
    return true;
  }
  return (product.variants ?? []).some((variant) =>
    SERIALIZED_INVENTORY_POLICIES.has(variant.inventory_tracking_policy ?? '')
  );
}

/**
 * Applies the canonical public serialized-inventory summaries to a related
 * product rail. The public summary path is the source of truth for both
 * strict serialized stock and serialized-then-unlimited products.
 */
export async function hydrateRelatedBlogProductSerializedInventory(
  supabase: SupabaseClient,
  merchantId: string,
  products: readonly RelatedBlogProduct[]
): Promise<RelatedBlogProduct[]> {
  const hydrated = await hydrateAndSanitizePublicProducts(
    supabase,
    merchantId,
    [...products]
  );

  return hydrated.map((product) => {
    if (!product.has_variants || !Array.isArray(product.variants)) {
      return product;
    }

    // Products without serialized inventory keep the first pass's parent-stock
    // fallback (hasStockedRelatedBlogVariant). The public purchasability check
    // below has no parent fallback and must only govern serialized summaries.
    if (!hasSerializedInventory(product)) {
      return product;
    }

    return {
      ...product,
      has_purchasable_variant: product.variants.some((variant) =>
        isPublicVariantPurchasable(product, variant)
      ),
    };
  });
}
