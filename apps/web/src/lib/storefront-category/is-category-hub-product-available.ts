import type { CategoryHubProduct } from '@/lib/storefront-category/category-hub-types';
import { parseCandidatePrice } from '@/lib/storefront-compare/is-price-band-candidate-available';
import { isAvailableProduct } from '@/lib/storefront-content/is-available-product';

function parseStockValue(value?: number | string | null): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function isCategoryHubProductAvailable(
  product: CategoryHubProduct
): boolean {
  const price = parseCandidatePrice(product.price);
  if (!Number.isFinite(price) || price <= 0) return false;
  if (product.has_condition_offers) return true;
  return isAvailableProduct({
    stock: parseStockValue(product.stock),
    stock_quantity: parseStockValue(product.stock_quantity),
    manage_stock: product.manage_stock,
  });
}
