import type { SupabaseClient } from '@supabase/supabase-js';
import { hydrateAndSanitizePublicProducts } from '@/lib/hydrate-public-products';
import { isPublicVariantPurchasable } from '@/lib/is-public-variant-purchasable';
import type { RelatedBlogProduct } from '@/lib/related-blog-products';

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

    return {
      ...product,
      has_purchasable_variant: product.variants.some((variant) =>
        isPublicVariantPurchasable(product, variant)
      ),
    };
  });
}
