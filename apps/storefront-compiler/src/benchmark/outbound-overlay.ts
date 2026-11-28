import type {
  BackingCatalogProduct,
  PublicProjectedProduct,
} from './ogabassey-catalog-fixture';

export function computeVariantStockOverlay(
  rows: readonly BackingCatalogProduct[],
  cachedBody: string
): Record<string, boolean> {
  const parsed = JSON.parse(cachedBody) as {
    products?: PublicProjectedProduct[];
    product?: PublicProjectedProduct | null;
  };
  const byId = new Map(rows.map((r) => [r.id, r]));
  const variantOverlay: Record<string, boolean> = {};
  const targets = parsed.products ?? (parsed.product ? [parsed.product] : []);
  for (const item of targets) {
    const backing = byId.get(item.id);
    if (!backing) continue;
    for (const variant of backing.variants) {
      variantOverlay[variant.id] = variant.stockQty > 0;
    }
  }
  return variantOverlay;
}

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
    const mergedVariants = product.variants.map((variant) => {
      const nextInStock = variantStockById[variant.id] ?? variant.inStock;
      return {
        ...variant,
        inStock: nextInStock,
        ...('available' in variant ? { available: nextInStock } : {}),
      };
    });
    const nextProductInStock = mergedVariants.some((v) => v.inStock);
    return {
      ...product,
      variants: mergedVariants,
      inStock: nextProductInStock,
      ...('available' in product ? { available: nextProductInStock } : {}),
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
