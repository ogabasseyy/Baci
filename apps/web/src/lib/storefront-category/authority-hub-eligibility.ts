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

/** Mirror parseSemanticProductPrice: grouped strings like '1,000,000' parse. */
function parseAuthorityProductPrice(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/,/g, '').trim();
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function isStringPricedDbRecord(product: unknown): boolean {
  if (!product || typeof product !== 'object') return false;
  const candidate = product as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.price === 'string' &&
    parseAuthorityProductPrice(candidate.price) !== null
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
          ? {
              ...record,
              price: parseAuthorityProductPrice(record.price) ?? record.price,
            }
          : record,
        { preferredCategorySlug: categorySlug }
      );
    })
    .filter((product) => product.availability === 'InStock');
  return resolveAvailableBrandAuthorityEligibility(availableProducts, entry);
}

/** Brand threshold for already available, category-scoped rows. */
function resolveAvailableBrandAuthorityEligibility<
  T extends { brand?: string | null },
>(products: readonly T[], entry: BrandAuthorityEntry) {
  const matched = products.filter((product) =>
    brandAuthorityTaxonomy.matchesBrand(entry, product.brand ?? null)
  );
  return {
    products: matched,
    productCount: matched.length,
    eligible: matched.length >= entry.minimumProducts,
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
  resolveAvailableBrandAuthorityEligibility,
  resolveFamilyAuthorityEligibility,
};
