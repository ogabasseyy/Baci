import { generateSlug } from '../seo-utils';
import { brandAuthorityTaxonomy } from '../storefront-category/brand-authority-taxonomy';
import { buildProductCompareCandidate } from './compare-eligibility';

export interface CommercialSupportBrandProduct {
  slug: string;
  name: string;
  price: number;
  brand?: string | null;
  category_slug?: string | null;
  product_key_specs?: Record<string, unknown> | null;
}

export function resolveCanonicalBrandKey(
  categorySlug: string,
  brand: string | null | undefined
): string {
  const raw = (brand ?? '').trim();
  if (!raw) {
    return '';
  }
  const matchingEntry = brandAuthorityTaxonomy
    .getEntries(categorySlug)
    .find((entry) => brandAuthorityTaxonomy.matchesBrand(entry, raw));
  return matchingEntry?.brandKey ?? generateSlug(raw);
}

export function normalizeInferredBrands(
  categorySlug: string,
  inferredBrands?: string[]
): string[] {
  return Array.from(
    new Set(
      (inferredBrands ?? [])
        .map((brand) => resolveCanonicalBrandKey(categorySlug, brand))
        .filter(Boolean)
    )
  );
}

export function filterProductsByBrandSlugs<
  T extends CommercialSupportBrandProduct,
>(categorySlug: string, products: T[], brandSlugs: string[]): T[] {
  return products.filter((product) => {
    const brandSlug = resolveCanonicalBrandKey(categorySlug, product.brand);
    return Boolean(brandSlug && brandSlugs.includes(brandSlug));
  });
}

export function findFirstEligibleProductCompare<
  T extends CommercialSupportBrandProduct,
>(
  categorySlug: string,
  products: T[],
  inferredBrands?: string[]
): { leftProduct: T; rightProduct: T } | null {
  const normalizedInferredBrands = normalizeInferredBrands(
    categorySlug,
    inferredBrands
  );

  if (normalizedInferredBrands.length > 0) {
    const preferredProducts = filterProductsByBrandSlugs(
      categorySlug,
      products,
      normalizedInferredBrands
    );

    if (preferredProducts.length >= 2) {
      for (
        let leftIndex = 0;
        leftIndex < preferredProducts.length - 1;
        leftIndex += 1
      ) {
        const leftProduct = preferredProducts[leftIndex];
        for (
          let rightIndex = leftIndex + 1;
          rightIndex < preferredProducts.length;
          rightIndex += 1
        ) {
          const rightProduct = preferredProducts[rightIndex];
          const candidate = buildProductCompareCandidate({
            categorySlug,
            leftProduct,
            rightProduct,
          });

          if (candidate.isIndexable) {
            return {
              leftProduct,
              rightProduct,
            };
          }
        }
      }
    }

    return null;
  }

  for (let leftIndex = 0; leftIndex < products.length - 1; leftIndex += 1) {
    const leftProduct = products[leftIndex];

    for (
      let rightIndex = leftIndex + 1;
      rightIndex < products.length;
      rightIndex += 1
    ) {
      const rightProduct = products[rightIndex];
      const candidate = buildProductCompareCandidate({
        categorySlug,
        leftProduct,
        rightProduct,
      });

      if (candidate.isIndexable) {
        return {
          leftProduct,
          rightProduct,
        };
      }
    }
  }

  return null;
}
