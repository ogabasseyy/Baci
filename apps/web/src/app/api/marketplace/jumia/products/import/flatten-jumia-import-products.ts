import type { getAllProducts } from '@/lib/jumia/catalog';

export type FlatJumiaImportEntry = {
  sku: string;
  name: string;
  description: string;
  price: number;
  images: string[];
  productId: string;
};

type FlattenedJumiaImportProducts = {
  flatEntries: FlatJumiaImportEntry[];
  skippedNoSkuCount: number;
  missingPriceCount: number;
};

export function flattenJumiaImportProducts(
  jumiaProducts: Awaited<ReturnType<typeof getAllProducts>>
): FlattenedJumiaImportProducts {
  let skippedNoSkuCount = 0;
  let missingPriceCount = 0;
  const flatEntries: FlatJumiaImportEntry[] = [];

  for (const product of jumiaProducts) {
    for (const variation of product.variations) {
      if (!variation.sellerSku) {
        skippedNoSkuCount++;
        continue;
      }
      if (variation.globalPrice?.value == null) {
        missingPriceCount++;
        continue;
      }
      flatEntries.push({
        sku: variation.sellerSku,
        name: product.name,
        description: product.description,
        price: variation.globalPrice.value,
        images: (product.images ?? [])
          .map((image) => image?.url)
          .filter(
            (value): value is string =>
              typeof value === 'string' && value.length > 0
          ),
        productId: product.id,
      });
    }
  }

  return { flatEntries, skippedNoSkuCount, missingPriceCount };
}
