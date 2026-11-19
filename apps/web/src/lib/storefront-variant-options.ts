/** Public selection facts shared by discovery feeds and purchasing summaries. */
export interface StorefrontVariantSelection {
  id: string;
  attributes?: Record<string, unknown> | null;
  condition?: string | null;
}

const PRIVATE_ATTRIBUTE_KEYS = new Set([
  'gtin',
  'mpn',
  'variantid',
  'variant_id',
  'color_hex',
  'colour_hex',
  'colorhex',
  'colourhex',
]);

export function getStorefrontVariantOptions(
  variant: StorefrontVariantSelection
): Record<string, string> {
  const options: Record<string, string> = {};
  for (const [key, value] of Object.entries(variant.attributes ?? {})) {
    const name = key
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_');
    if (!name || PRIVATE_ATTRIBUTE_KEYS.has(name)) continue;
    const text =
      typeof value === 'string'
        ? value.trim()
        : typeof value === 'number' && Number.isFinite(value)
          ? String(value)
          : '';
    if (text) options[name === 'colour' ? 'color' : name] = text;
  }
  if (variant.condition) options.condition = variant.condition;
  return options;
}
