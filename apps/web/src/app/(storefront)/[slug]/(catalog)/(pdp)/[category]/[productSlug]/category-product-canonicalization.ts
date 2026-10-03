import { normalizeStorefrontCategorySlug } from '@/lib/normalize-storefront-category-slug';

export interface CategoryProductRouteIdentity {
  requestedCategorySlug: string;
  requestedProductSlug: string;
  resolvedCategorySlug: string | null | undefined;
  resolvedProductSlug: string | null | undefined;
}

function isUuidProductRouteValue(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value
  );
}

export function evaluateCategoryProductCanonicalRoute({
  requestedCategorySlug,
  requestedProductSlug,
  resolvedCategorySlug,
  resolvedProductSlug,
}: CategoryProductRouteIdentity) {
  const normalizedResolvedCategory =
    normalizeStorefrontCategorySlug(resolvedCategorySlug);
  const normalizedRequestedCategory = normalizeStorefrontCategorySlug(
    requestedCategorySlug
  );
  const needsValuesRedirect =
    !isUuidProductRouteValue(requestedProductSlug) &&
    Boolean(resolvedProductSlug) &&
    resolvedProductSlug !== requestedProductSlug &&
    resolvedProductSlug?.toLowerCase() === requestedProductSlug.toLowerCase();

  return {
    categoryMismatch: Boolean(
      normalizedResolvedCategory &&
        normalizedResolvedCategory !== normalizedRequestedCategory
    ),
    needsValuesRedirect,
  };
}
