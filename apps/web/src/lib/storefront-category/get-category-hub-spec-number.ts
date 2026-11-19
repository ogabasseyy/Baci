import type { CategoryHubProduct } from '@/lib/storefront-category/category-hub-types';

export function getCategoryHubSpecNumber(
  product: CategoryHubProduct,
  key: string
): number | null {
  const value = product.product_key_specs?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
