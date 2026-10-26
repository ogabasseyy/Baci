import { isExplicitlyTrackedVariantStock } from './is-explicitly-tracked-variant-stock';
import { getEffectiveStock } from './product-stock';
import { resolveSerializedVariantStock } from './serialized-variant-stock';

/** Shared inventory decision for public availability and cart enforcement. */
export function resolveVariantInventory(
  parent: {
    manage_stock?: boolean | null;
    stock?: number | null;
    stock_quantity?: number | null;
  },
  variant: {
    effective_policy?: string | null;
    inventory_tracking_policy?: string | null;
    available_units?: number | null;
    stock_quantity?: number | null;
  }
) {
  const tracked = isExplicitlyTrackedVariantStock(variant);
  const manageStock = tracked
    ? true
    : parent.manage_stock === null
      ? true
      : parent.manage_stock === true;
  const stock =
    resolveSerializedVariantStock(variant) ??
    variant.stock_quantity ??
    getEffectiveStock(parent);
  return {
    manageStock,
    stock: manageStock === false ? getEffectiveStock(parent) : stock,
    stockQuantity: manageStock === false ? Number.POSITIVE_INFINITY : stock,
    purchasable: manageStock !== true || stock > 0,
  };
}
