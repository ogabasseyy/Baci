import { getVariantSchemaColor } from './product-schema-color';
import { getVariantSchemaSize } from './product-schema-size';
import type { ProductVariant } from './products';

function schemaPropertyForAttribute(key: string): string | undefined {
  // Only declare dimensions that the variant serializer actually emits.
  // Material, pattern, age and gender need matching variant fields first.
  const map: Record<string, string> = {
    color: 'https://schema.org/color',
    colour: 'https://schema.org/color',
    size: 'https://schema.org/size',
    storage: 'https://schema.org/size',
    ram: 'https://schema.org/size',
  };
  const normalizedKey = key.toLowerCase();
  return Object.hasOwn(map, normalizedKey) ? map[normalizedKey] : undefined;
}

export function getVariantSchemaVariesBy(variants: ProductVariant[]): string[] {
  const allAttributeKeys = new Set<string>();
  for (const variant of variants) {
    if (variant.attributes) {
      for (const key of Object.keys(variant.attributes)) {
        allAttributeKeys.add(key);
      }
    }
  }

  if (allAttributeKeys.size > 0) {
    // Only include Google-supported variesBy values, deduplicated
    const variesBySet = new Set<string>();
    for (const key of allAttributeKeys) {
      const url = schemaPropertyForAttribute(key);
      if (
        url &&
        (url !== 'https://schema.org/color' ||
          variants.every((variant) =>
            getVariantSchemaColor(variant.attributes)
          )) &&
        (url !== 'https://schema.org/size' ||
          variants.every((variant) => getVariantSchemaSize(variant.attributes)))
      ) {
        variesBySet.add(url);
      }
    }
    if (variesBySet.size > 0) {
      return Array.from(variesBySet);
    }
  }

  return [];
}
