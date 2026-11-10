import type { CategoryHubProduct } from '@/lib/storefront-category/category-hub-types';
import { getCategoryHubSpecNumber } from '@/lib/storefront-category/get-category-hub-spec-number';

export function compareBySpecDescThenPriceAsc(
  specKey: string
): (left: CategoryHubProduct, right: CategoryHubProduct) => number {
  return (left, right) =>
    (getCategoryHubSpecNumber(right, specKey) ?? 0) -
      (getCategoryHubSpecNumber(left, specKey) ?? 0) ||
    left.price - right.price ||
    left.name.localeCompare(right.name) ||
    left.slug.localeCompare(right.slug);
}
