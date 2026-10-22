import type { SerializedVariantStockLike } from './serialized-variant-stock';
import { resolveSerializedVariantStock } from './serialized-variant-stock';

export function isExplicitlyTrackedVariantStock(
  variant:
    | Pick<
        SerializedVariantStockLike,
        | 'effective_policy'
        | 'inventory_tracking_policy'
        | 'available_units'
        | 'stock_quantity'
      >
    | null
    | undefined
): boolean {
  if (variant == null) return false;
  const policy = variant.effective_policy ?? variant.inventory_tracking_policy;
  return (
    policy === 'standard' ||
    resolveSerializedVariantStock(variant) !== undefined
  );
}
