import type { SerializedVariantStockLike } from './serialized-variant-stock';

/** `off` disables serialized tracking; only unmanaged products have infinite stock. */
export function isUnmanagedVariantStock(
  variant:
    | Pick<
        SerializedVariantStockLike,
        'effective_policy' | 'inventory_tracking_policy'
      >
    | null
    | undefined,
  manageStock: boolean | null | undefined
): boolean {
  return (
    manageStock === false &&
    variant != null &&
    (variant.effective_policy ?? variant.inventory_tracking_policy) === 'off'
  );
}
