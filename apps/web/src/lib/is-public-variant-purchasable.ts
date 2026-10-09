import { getEffectiveStock } from './product-stock';
import { resolveSerializedVariantStock } from './serialized-variant-stock';

/** Evaluate hydrated public units before applying the parent stock policy. */
export function isPublicVariantPurchasable(
  parent: {
    manage_stock?: boolean | null;
    stock?: number | null;
    stock_quantity?: number | null;
  },
  variant: {
    inventory_tracking_policy?: string | null;
    effective_policy?: string | null;
    available_units?: number | null;
    stock_quantity?: number | null;
  }
): boolean {
  // Serialized tracking resolves from exact units (strict) or stays enabled
  // (unlimited); only non-serialized variants reach the scalar/parent logic.
  const serializedStock = resolveSerializedVariantStock(variant);
  if (serializedStock !== undefined) {
    return serializedStock > 0;
  }
  // The categorized PDP normalizes legacy null manage_stock to managed
  // inventory before downstream evaluation; match it so a depleted child
  // under a null parent is unavailable everywhere. An ABSENT policy
  // (undefined) means no inventory data was projected, so it stays
  // fail-open.
  if (parent.manage_stock !== true && parent.manage_stock !== null) {
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
