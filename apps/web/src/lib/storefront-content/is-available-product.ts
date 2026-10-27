import { getEffectiveProductStock } from '@/lib/product-stock';

/**
 * Single availability predicate mirroring the destination contract
 * (coerceStorefrontManageStock in storefront-agent-availability):
 * null/missing/false stock tracking means unmanaged inventory, which is
 * available without a finite quantity; explicitly managed rows require
 * positive effective stock (stock_quantity with legacy stock fallback,
 * via getEffectiveProductStock; unknown stock is out of stock).
 */
export function isAvailableProduct(product: {
  stock?: number | null;
  stock_quantity?: number | null;
  manage_stock?: boolean | null;
}): boolean {
  if (product.manage_stock !== true) {
    return true;
  }
  return getEffectiveProductStock(product) > 0;
}
