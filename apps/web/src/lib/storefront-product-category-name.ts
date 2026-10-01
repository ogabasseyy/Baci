import { generateSlug } from './seo-utils';
import { isUnsupportedSpecValue } from './storefront-specs/is-unsupported-spec-value';

type StorefrontProductNamedCategory = {
  name?: string | null;
  slug?: string | null;
} | null;

type StorefrontProductCategoryNameInput = {
  categories?: StorefrontProductNamedCategory;
  category?: string | null;
  category_slug?: string | null;
};

/**
 * Uses relation-backed category metadata for display and taxonomy decisions.
 * A slug is still stronger than legacy text when a partial join lacks a name,
 * because it identifies the current category relation.
 */
export function resolveStorefrontProductCategoryName(
  product: StorefrontProductCategoryNameInput
): string | null {
  const directName = product.categories?.name?.trim();
  if (directName && !isUnsupportedSpecValue(directName)) {
    return directName;
  }

  const directSlug = product.categories?.slug?.trim();
  if (directSlug && !isUnsupportedSpecValue(directSlug)) {
    return directSlug;
  }

  const canonicalSlug = product.category_slug?.trim();
  if (canonicalSlug && !isUnsupportedSpecValue(canonicalSlug)) {
    return canonicalSlug;
  }

  const legacyCategory = product.category?.trim();
  if (legacyCategory && !isUnsupportedSpecValue(legacyCategory)) {
    return legacyCategory;
  }

  return null;
}

/**
 * Resolves the storefront category slug used for URLs and canonical paths.
 * Placeholder joined slugs such as `unknown` are skipped so legacy category
 * text can derive a usable slug instead.
 */
export function resolveStorefrontProductCategorySlug(
  product: StorefrontProductCategoryNameInput
): string | null {
  const directSlug = product.categories?.slug?.trim();
  if (directSlug && !isUnsupportedSpecValue(directSlug)) {
    return directSlug;
  }

  const canonicalSlug = product.category_slug?.trim();
  if (canonicalSlug && !isUnsupportedSpecValue(canonicalSlug)) {
    return canonicalSlug;
  }

  const categoryName = resolveStorefrontProductCategoryName(product);
  return categoryName && !isUnsupportedSpecValue(categoryName)
    ? categoryName
    : null;
}

/**
 * Preserves authoritative joined or top-level slugs verbatim and slugifies
 * only display-text fallbacks for URL serialization.
 */
export function resolveMappedStorefrontProductCategorySlug(
  product: StorefrontProductCategoryNameInput
): string | undefined {
  const directSlug = product.categories?.slug?.trim();
  if (directSlug && !isUnsupportedSpecValue(directSlug)) {
    return directSlug;
  }

  const canonicalSlug = product.category_slug?.trim();
  if (canonicalSlug && !isUnsupportedSpecValue(canonicalSlug)) {
    return canonicalSlug;
  }

  const categoryName = resolveStorefrontProductCategoryName(product);
  return categoryName ? generateSlug(categoryName) : undefined;
}

export function resolveSupportedStorefrontProductCategoryRelation(
  categories: Array<{ name?: string | null; slug?: string | null }>
) {
  return categories.find((category) =>
    Boolean(resolveStorefrontProductCategoryName({ categories: category }))
  );
}
