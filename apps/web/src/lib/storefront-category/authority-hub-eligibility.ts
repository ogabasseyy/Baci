import {
  isRawDbProductRecord,
  normalizeProduct,
} from '@/lib/normalize-product';
import { brandAuthorityTaxonomy } from './brand-authority-taxonomy';
import type {
  BrandAuthorityEntry,
  ModelFamilyAuthorityEntry,
} from './category-hub-types';
import { modelFamilyAuthorityTaxonomy } from './model-family-authority-taxonomy';

/** Input must be the destination's complete, hydrated, category-scoped pool. */
export function resolveBrandAuthorityEligibility(
  products: readonly unknown[],
  categorySlug: string,
  entry: BrandAuthorityEntry
) {
  const availableProducts = products
    .filter(isRawDbProductRecord)
    .map((product) =>
      normalizeProduct(product, { preferredCategorySlug: categorySlug })
    )
    .filter(
      (product) =>
        product.availability === 'InStock' &&
        brandAuthorityTaxonomy.matchesBrand(entry, product.brand ?? null)
    );
  return {
    products: availableProducts,
    productCount: availableProducts.length,
    eligible: availableProducts.length >= entry.minimumProducts,
  };
}

/** A family always inherits an eligible parent's complete available pool. */
export function resolveFamilyAuthorityEligibility<T extends { name: string }>(
  products: readonly T[],
  entry: ModelFamilyAuthorityEntry
) {
  const matched = products.filter((product) =>
    modelFamilyAuthorityTaxonomy.matchesProduct(entry, product.name)
  );
  return {
    products: matched,
    productCount: matched.length,
    eligible: matched.length >= entry.minimumProducts,
  };
}
