import { getEffectiveStock } from '@/lib/product-stock';
import type { ProductVariant } from '@/lib/products';
import { resolveSerializedVariantStock } from '@/lib/serialized-variant-stock';
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

      return (
        conditionMatches &&
        Object.entries(partialAttributes).every(
          ([key, value]) => variant.attributes[key] === value
        )
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
    return (
      conditionMatches &&
      matches &&
      (serializedStock ??
        getEffectiveStock({
          stock: variant.stock_quantity ?? fallbackStock,
          stock_quantity: variant.stock_quantity ?? fallbackStock,
        })) > 0
    );
  });
}
