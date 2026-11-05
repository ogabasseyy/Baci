import type { ProductVariant } from './products';

/**
 * Maps common variant attribute keys to Google-supported variesBy property URLs.
 * Google only recognizes 6 specific values for variesBy:
 * color, size, suggestedAge, suggestedGender, material, pattern
 * Unsupported attributes return undefined and are excluded from variesBy.
 * @see https://developers.google.com/search/docs/appearance/structured-data/product#product-variants
 */
function schemaPropertyForAttribute(key: string): string | undefined {
  const map: Record<string, string> = {
    color: 'https://schema.org/color',
    colour: 'https://schema.org/color',
    size: 'https://schema.org/size',
    storage: 'https://schema.org/size',
    ram: 'https://schema.org/size',
    material: 'https://schema.org/material',
    pattern: 'https://schema.org/pattern',
    age: 'https://schema.org/suggestedAge',
    gender: 'https://schema.org/suggestedGender',
  };
  return map[key.toLowerCase()];
}

export function isValidMerchantIdentifier(
  value: string | null | undefined
): value is string {
  return Boolean(
    value && Array.from(value).length <= 50 && !/[\s\p{C}]/u.test(value)
  );
}

function getNormalizedVariantAttribute(
  attributes: Record<string, string> | null | undefined,
  keys: string[]
): string | undefined {
  if (!attributes) {
    return undefined;
  }

  for (const key of keys) {
    const matchedKey =
      key in attributes
        ? key
        : Object.keys(attributes).find(
            (attributeKey) => attributeKey.toLowerCase() === key.toLowerCase()
          );
    const value = matchedKey ? attributes[matchedKey] : undefined;
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return undefined;
}

export function getVariantSchemaColor(
  attributes: Record<string, string> | null | undefined
): string | undefined {
  return getNormalizedVariantAttribute(attributes, ['color', 'colour']);
}

export function getVariantSchemaSize(
  attributes: Record<string, string> | null | undefined
): string | undefined {
  const explicitSize = getNormalizedVariantAttribute(attributes, ['size']);
  if (explicitSize && Array.from(explicitSize).length <= 100) {
    return explicitSize;
  }

  const inferredParts = [
    getNormalizedVariantAttribute(attributes, ['storage']),
    getNormalizedVariantAttribute(attributes, ['ram']),
  ].filter(
    (value): value is string =>
      Boolean(value) && Array.from(value as string).length <= 100
  );

  if (inferredParts.length === 0) {
    return undefined;
  }

  const size = Array.from(new Set(inferredParts)).join(' / ');
  return Array.from(size).length <= 100 ? size : undefined;
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
export function buildVariantSchemaName(
  productName: string,
  attributes: ProductVariant['attributes']
): string {
  // Keep the product title and as many complete option values as fit.
  // Some catalog records contain full specification paragraphs as attributes.
  let variantName = Array.from(productName).slice(0, 150).join('');
  for (const value of Object.values(attributes ?? {})) {
    if (typeof value !== 'string' || !value.trim()) continue;
    const candidate = `${variantName}${variantName === productName ? ' - ' : ' / '}${value.trim()}`;
    if (Array.from(candidate).length <= 150) variantName = candidate;
  }

  return variantName;
}
