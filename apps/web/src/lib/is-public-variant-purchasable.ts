import { getEffectiveStock } from './product-stock';

/** Evaluate hydrated public units before applying the parent stock policy. */
export function isPublicVariantPurchasable(
  parent: {
    manage_stock?: boolean | null;
    stock?: number | null;
    stock_quantity?: number | null;
  },
  variant: {
    inventory_tracking_policy?: string | null;
    stock_quantity?: number | null;
  }
): boolean {
  if (variant.inventory_tracking_policy === 'serialized_strict') {
    return (variant.stock_quantity ?? 0) > 0;
  }
  if (variant.inventory_tracking_policy === 'serialized_then_unlimited') {
    return true;
  }
  if (parent.manage_stock !== true) {
    return true;
  }
  // Legacy nullable child quantities inherit the parent stock, matching the
  // PDP, the price-range path, and hasStockedRelatedBlogVariant. Serialized
  // variants above stay exact: their hydrated units are authoritative.
  if (variant.stock_quantity == null) {
    return getEffectiveStock(parent) > 0;
  }
  return variant.stock_quantity > 0;
}
