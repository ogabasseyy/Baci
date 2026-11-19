import { buildProductCompareCandidate } from './compare-eligibility';
import { buildCanonicalProductCompareSlug } from './compare-slugs';
import { filterProductsByBrandSlugs } from './filter-products-by-brand-slugs';
import { normalizeInferredBrands } from './normalize-inferred-brands';
import type { CommercialSupportBrandProduct } from './resolve-canonical-brand-key';
import { resolveCanonicalBrandKey } from './resolve-canonical-brand-key';

export function findFirstEligibleProductCompare<
  T extends CommercialSupportBrandProduct,
>(
  categorySlug: string,
  products: T[],
  inferredBrands?: string[],
  approvedCompareSlugs?: ReadonlySet<string>
): { leftProduct: T; rightProduct: T } | null {
  const isApproved = (left: T, right: T) =>
    !approvedCompareSlugs ||
    approvedCompareSlugs.has(
      buildCanonicalProductCompareSlug(left.slug, right.slug)
    );
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
      // Multi-brand articles must compare across brands, not within one.
      const requireDistinctBrands = normalizedInferredBrands.length > 1;
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
          if (
            requireDistinctBrands &&
            resolveCanonicalBrandKey(categorySlug, leftProduct.brand) ===
              resolveCanonicalBrandKey(categorySlug, rightProduct.brand)
          ) {
            continue;
          }
          const candidate = buildProductCompareCandidate({
            categorySlug,
            leftProduct,
            rightProduct,
          });

          if (candidate.isIndexable && isApproved(leftProduct, rightProduct)) {
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

      if (candidate.isIndexable && isApproved(leftProduct, rightProduct)) {
        return {
          leftProduct,
          rightProduct,
        };
      }
    }
  }

  return null;
}
