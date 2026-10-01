/**
 * Resolve the relation-backed category slug embedded in a raw PostgREST
 * product row. The direct category_id join wins when active; otherwise the
 * active junction category with the lowest category_id wins.
 */
export function resolveStorefrontProductPurgeCategorySlug(input: {
  categories?: unknown;
  productCategories?: unknown;
}): string | null {
  const directSlug = extractDirectCategorySlug(input.categories);
  if (directSlug) {
    return directSlug;
  }

  return extractJunctionCategorySlug(input.productCategories);
}

function extractDirectCategorySlug(categories: unknown): string | null {
  const records = Array.isArray(categories) ? categories : [categories];
  for (const record of records) {
    if (!record || typeof record !== 'object' || !('slug' in record)) {
      continue;
    }
    const category = record as { is_active?: unknown; slug?: unknown };
    if (
      ('is_active' in category && category.is_active !== true) ||
      typeof category.slug !== 'string' ||
      !category.slug.trim()
    ) {
      continue;
    }
    return category.slug.trim();
  }
  return null;
}

function extractJunctionCategorySlug(
  productCategories: unknown
): string | null {
  if (!Array.isArray(productCategories)) {
    return null;
  }

  const candidates: Array<{
    categoryId: string | null;
    index: number;
    slug: string;
  }> = [];
  for (const [index, entry] of productCategories.entries()) {
    const relation =
      entry && typeof entry === 'object'
        ? (entry as { categories?: unknown; category_id?: unknown })
        : null;
    const slug = extractDirectCategorySlug(relation?.categories);
    if (!slug) {
      continue;
    }
    const rawCategoryId = relation?.category_id;
    candidates.push({
      categoryId:
        typeof rawCategoryId === 'string' && rawCategoryId.trim()
          ? rawCategoryId.trim()
          : null,
      index,
      slug,
    });
  }

  candidates.sort((left, right) => {
    if (!left.categoryId && !right.categoryId) {
      return left.index - right.index;
    }
    if (!left.categoryId) return 1;
    if (!right.categoryId) return -1;
    return (
      (left.categoryId < right.categoryId
        ? -1
        : left.categoryId > right.categoryId
          ? 1
          : 0) || left.index - right.index
    );
  });

  return candidates[0]?.slug ?? null;
}
