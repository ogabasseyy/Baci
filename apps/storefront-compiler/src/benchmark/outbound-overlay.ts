import type { PublicProjectedProduct } from './ogabassey-catalog-fixture';

export function applyVariantStockOverlayToJson(
  cachedBody: string,
  variantStockById: Readonly<Record<string, boolean>>,
  generations?: { coupled: number; availability: number }
): string {
  const parsed = JSON.parse(cachedBody) as {
    generation?: number;
    availabilityGeneration?: number;
    products?: PublicProjectedProduct[];
    product?: PublicProjectedProduct | null;
    [key: string]: unknown;
  };

  if (generations) {
    parsed.generation = generations.coupled;
    parsed.availabilityGeneration = generations.availability;
  }

  const mergeProduct = (
    product: PublicProjectedProduct
  ): PublicProjectedProduct => {
    const mergedVariants = product.variants.map((variant) => ({
      ...variant,
      inStock: variantStockById[variant.id] ?? variant.inStock,
    }));
    return {
      ...product,
      variants: mergedVariants,
      inStock: mergedVariants.some((v) => v.inStock),
    };
  };

  if (Array.isArray(parsed.products)) {
    parsed.products = parsed.products.map(mergeProduct);
  }
  if (parsed.product) {
    parsed.product = mergeProduct(parsed.product);
  }
  return JSON.stringify(parsed);
}
