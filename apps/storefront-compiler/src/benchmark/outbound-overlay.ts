import type { PublicProjectedProduct } from './ogabassey-catalog-fixture';

export function applyVariantStockOverlayToJson(
  cachedBody: string,
  variantStockById: Readonly<Record<string, boolean>>
): string {
  const parsed = JSON.parse(cachedBody) as {
    products?: PublicProjectedProduct[];
    product?: PublicProjectedProduct | null;
    [key: string]: unknown;
  };

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
