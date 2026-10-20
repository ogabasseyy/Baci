import type { ProductVariant } from '@/lib/products';

/**
 * Extract unique attribute types and their values from variants
 */
export function getAttributeOptions(
  variants: ProductVariant[]
): { key: string; values: string[] }[] {
  const attributeMap = new Map<string, Set<string>>();

  for (const variant of variants) {
    for (const [key, value] of Object.entries(variant.attributes)) {
      if (!attributeMap.has(key)) {
        attributeMap.set(key, new Set());
      }
      attributeMap.get(key)?.add(value);
    }
  }

  return Array.from(attributeMap.entries()).map(([key, values]) => ({
    key,
    values: Array.from(values).sort(),
  }));
}
