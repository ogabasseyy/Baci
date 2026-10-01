type StorefrontProductCategoryRecord = {
  id?: string | null;
  is_active?: boolean | null;
  slug?: string | null;
};

type StorefrontProductCategory =
  | StorefrontProductCategoryRecord
  | readonly StorefrontProductCategoryRecord[]
  | null
  | undefined;

type StorefrontProductCategoryPrecedenceInput = {
  categories?: StorefrontProductCategory;
  category?: string | null;
  product_categories?: ReadonlyArray<{
    category_id?: string | null;
    categories?: StorefrontProductCategory;
  }> | null;
};

function firstActiveCategory(
  value: StorefrontProductCategory
): StorefrontProductCategoryRecord | null {
  const candidates = Array.isArray(value) ? value : value ? [value] : [];
  return (
    candidates.find(
      (candidate) =>
        (!('is_active' in candidate) || candidate.is_active === true) &&
        Boolean(candidate.slug?.trim())
    ) ?? null
  );
}

function compareCategoryIds(left: string | null, right: string | null): number {
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Resolves the active storefront category used by the PDP canonical path.
 * Product URLs use the direct category join first, then the active
 * product_categories junction. The legacy text column is only the final
 * string fallback passed separately to getProductUrl; it must not override an
 * active relation-backed category when the direct category was retired.
 */
export function resolveStorefrontProductCategory(
  product: StorefrontProductCategoryPrecedenceInput
): { slug: string } | null {
  const directSlug = firstActiveCategory(product.categories)?.slug?.trim();
  if (directSlug) {
    return { slug: directSlug };
  }

  const junctionSlug = (product.product_categories ?? [])
    .map((entry, index) => {
      const category = firstActiveCategory(entry.categories);
      if (!category?.slug?.trim()) return null;
      const categoryId =
        entry.category_id?.trim() || category.id?.trim() || null;
      return { categoryId, category, index };
    })
    .filter(
      (
        candidate
      ): candidate is {
        categoryId: string | null;
        category: StorefrontProductCategoryRecord;
        index: number;
      } => Boolean(candidate)
    )
    .sort(
      (left, right) =>
        compareCategoryIds(left.categoryId, right.categoryId) ||
        left.index - right.index
    )[0]
    ?.category.slug?.trim();

  return junctionSlug ? { slug: junctionSlug } : null;
}
