import { getEffectiveStock } from '@/lib/product-stock';
import type { ProductVariant } from '@/lib/products';
import {
  isUnmanagedVariantStock,
  resolveSerializedVariantStock,
} from '@/lib/serialized-variant-stock';
import type { ProductCondition } from './product-selection-condition';

/**
 * Check if a variant with given attributes exists and has stock.
 * Serialized tracking resolves from exact units (strict) or stays
 * enabled with no finite count (unlimited); other variants use the
 * scalar quantity with parent-stock inheritance.
 */
export function isVariantAvailable(
  variants: ProductVariant[],
  partialAttributes: Record<string, string>,
  isStockManaged: boolean,
  fallbackStock: number,
  options?: {
    condition?: ProductCondition | null;
    usesVariantConditions?: boolean;
  }
): boolean {
  if (!isStockManaged) {
    return variants.some((variant) => {
      const conditionMatches =
        !options?.usesVariantConditions ||
        !options.condition ||
        variant.condition === options.condition;
      const matches = Object.entries(partialAttributes).every(
        ([key, value]) => variant.attributes[key] === value
      );
      if (!conditionMatches || !matches) {
        return false;
      }
      // A child variant can override an unmanaged parent with a
      // serialized policy: resolve its exact units instead of assuming
      // availability from the attribute match alone, or the option
      // button enables a zero-unit strict variant the purchase checks
      // then reject.
      const serializedStock = resolveSerializedVariantStock(variant);
      return (
        isUnmanagedVariantStock(variant) ||
        serializedStock == null ||
        serializedStock > 0
      );
    });
  }

  return variants.some((variant) => {
    const conditionMatches =
      !options?.usesVariantConditions ||
      !options.condition ||
      variant.condition === options.condition;
    const matches = Object.entries(partialAttributes).every(
      ([key, value]) => variant.attributes[key] === value
    );
    const serializedStock = resolveSerializedVariantStock(variant);
    const variantIsUnmanaged = isUnmanagedVariantStock(variant);
    return (
      conditionMatches &&
      matches &&
      (variantIsUnmanaged ||
        (serializedStock ??
          getEffectiveStock({
            stock: variant.stock_quantity ?? fallbackStock,
            stock_quantity: variant.stock_quantity ?? fallbackStock,
          })) > 0)
    );
  });
}
