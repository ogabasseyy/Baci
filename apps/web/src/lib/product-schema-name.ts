import type { ProductVariant } from './products';

const PRIORITY_ATTRIBUTE_KEYS = ['color', 'colour', 'size', 'storage', 'ram'];

export function buildVariantSchemaName(
  productName: string,
  attributes: ProductVariant['attributes']
): string {
  // Keep the product title and as many complete option values as fit.
  // Prioritize distinguishing variant attributes before general spec entries.
  const baseName = Array.from(productName).slice(0, 150).join('');
  let variantName = baseName;
  let hasAppendedAttribute = false;

  const entries = Object.entries(attributes ?? {});
  const orderedEntries = [
    ...entries.filter(([key]) =>
      PRIORITY_ATTRIBUTE_KEYS.includes(key.toLowerCase())
    ),
    ...entries.filter(
      ([key]) => !PRIORITY_ATTRIBUTE_KEYS.includes(key.toLowerCase())
    ),
  ];

  const seenValues = new Set<string>();
  for (const [, value] of orderedEntries) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed || seenValues.has(trimmed)) continue;
    seenValues.add(trimmed);
    const separator = hasAppendedAttribute ? ' / ' : ' - ';
    const candidate = `${variantName}${separator}${trimmed}`;
    if (Array.from(candidate).length <= 150) {
      variantName = candidate;
      hasAppendedAttribute = true;
    }
  }

  return variantName;
}
