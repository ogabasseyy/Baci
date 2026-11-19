import type { ProductVariant } from './products';

const PRIORITY_ATTRIBUTE_KEYS = ['color', 'colour', 'size', 'storage', 'ram'];

export function buildVariantSchemaName(
  productName: string,
  attributes: ProductVariant['attributes']
): string {
  // Keep the product title and as many complete option values as fit.
  // Prioritize distinguishing variant attributes before general spec entries.
  const entries = Object.entries(attributes ?? {});
  const orderedEntries = [
    ...entries.filter(([key]) =>
      PRIORITY_ATTRIBUTE_KEYS.includes(key.toLowerCase())
    ),
    ...entries.filter(
      ([key]) => !PRIORITY_ATTRIBUTE_KEYS.includes(key.toLowerCase())
    ),
  ];

  const orderedValues: string[] = [];
  const seenValues = new Set<string>();
  for (const [, value] of orderedEntries) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed || seenValues.has(trimmed)) continue;
    seenValues.add(trimmed);
    orderedValues.push(trimmed);
  }

  const firstFittingAttr = orderedValues.find(
    (value) => Array.from(value).length <= 100
  );
  const firstFittingCodePoints = firstFittingAttr
    ? Array.from(firstFittingAttr).length
    : 0;
  const maxBaseLength =
    firstFittingCodePoints > 0
      ? Math.max(1, 150 - 3 - firstFittingCodePoints)
      : 150;

  let variantName = Array.from(productName).slice(0, maxBaseLength).join('');
  let hasAppendedAttribute = false;

  for (const trimmed of orderedValues) {
    const separator = hasAppendedAttribute ? ' / ' : ' - ';
    const candidate = `${variantName}${separator}${trimmed}`;
    if (Array.from(candidate).length <= 150) {
      variantName = candidate;
      hasAppendedAttribute = true;
    }
  }

  return variantName;
}
