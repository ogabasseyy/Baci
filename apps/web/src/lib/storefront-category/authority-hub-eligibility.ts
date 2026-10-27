import {
  isRawDbProductRecord,
  normalizeProduct,
  type RawDbProduct,
} from '@/lib/normalize-product';
import { brandAuthorityTaxonomy } from './brand-authority-taxonomy';
import type {
  BrandAuthorityEntry,
  ModelFamilyAuthorityEntry,
} from './category-hub-types';
import { modelFamilyAuthorityTaxonomy } from './model-family-authority-taxonomy';

function isStringPricedDbRecord(product: unknown): boolean {
  if (!product || typeof product !== 'object') return false;
  const candidate = product as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.price === 'string' &&
    candidate.price.trim() !== '' &&
    Number.isFinite(Number(candidate.price))
  );
}

/**
 * Brand-only eligibility within a caller-scoped pool: input must be the
 * destination's complete, hydrated, category-scoped pool (callers own
 * category, parent/variant, and active-status scoping, exactly as the
 * destination loaders supply it). This helper owns availability + brand.
 */
function resolveBrandAuthorityEligibility(
  products: readonly unknown[],
  categorySlug: string,
  entry: BrandAuthorityEntry
) {
  const availableProducts = products
    .filter(
      (product) =>
        isRawDbProductRecord(product) || isStringPricedDbRecord(product)
    )
    .map((product) => {
      const record = product as RawDbProduct;
      return normalizeProduct(
        // PostgREST can return numeric columns as strings; sibling
        // loaders coerce instead of dropping those rows.
        typeof record.price === 'string'
          ? { ...record, price: Number(record.price) }
          : record,
        { preferredCategorySlug: categorySlug }
      );
    })
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
function resolveFamilyAuthorityEligibility<T extends { name: string }>(
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

export const authorityHubEligibility = {
  resolveBrandAuthorityEligibility,
  resolveFamilyAuthorityEligibility,
};
