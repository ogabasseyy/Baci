import type { CategoryHubProduct } from '@/lib/storefront-category/category-hub-types';
import { isAvailableProduct } from '@/lib/storefront-content/is-available-product';

export function isCategoryHubProductAvailable(
  product: CategoryHubProduct
): boolean {
  if (!Number.isFinite(product.price) || product.price <= 0) return false;
  if (product.has_condition_offers) return true;
  return isAvailableProduct(product);
}
