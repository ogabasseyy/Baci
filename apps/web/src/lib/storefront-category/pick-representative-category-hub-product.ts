import type { CategoryHubProduct } from '@/lib/storefront-category/category-hub-types';

export function pickRepresentativeCategoryHubProduct(
  products: CategoryHubProduct[],
  comparator: (left: CategoryHubProduct, right: CategoryHubProduct) => number
): CategoryHubProduct | null {
  return products.length > 0 ? [...products].sort(comparator)[0] : null;
}
