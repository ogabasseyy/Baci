export interface SerializedVariantStockLike {
  effective_policy?: string | null;
  inventory_tracking_policy?: string | null;
  available_units?: number | null;
  stock_quantity?: number | string | null;
}

/**
 * Effective purchasable stock for a hydrated public variant, mirroring the
 * native selector: unlimited tracking stays enabled with no finite count
 * (POSITIVE_INFINITY, matching the unmanaged convention), strict tracking
 * compares exact serialized units (scalar fallback when units were not
 * projected), and other policies return undefined so callers apply their
 * scalar/parent logic. The inherited effective_policy governs when present;
 * the row-local tracking policy is the back-compat fallback.
 */
export function resolveSerializedVariantStock(
  variant: SerializedVariantStockLike
): number | undefined {
  const policy = variant.effective_policy ?? variant.inventory_tracking_policy;
  if (policy === 'serialized_then_unlimited') {
    return Number.POSITIVE_INFINITY;
  }
  if (policy === 'serialized_strict') {
    if (
      typeof variant.available_units === 'number' &&
      Number.isFinite(variant.available_units)
    ) {
      return Math.max(0, variant.available_units);
    }
    if (
      typeof variant.stock_quantity === 'number' &&
      Number.isFinite(variant.stock_quantity)
    ) {
      return Math.max(0, variant.stock_quantity);
    }
    return 0;
  }
  return undefined;
}
