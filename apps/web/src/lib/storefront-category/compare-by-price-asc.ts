import type { CategoryHubProduct } from '@/lib/storefront-category/category-hub-types';

export function compareByPriceAsc(
  left: CategoryHubProduct,
  right: CategoryHubProduct
): number {
  return (
    left.price - right.price ||
    left.name.localeCompare(right.name) ||
    left.slug.localeCompare(right.slug)
  );
}
