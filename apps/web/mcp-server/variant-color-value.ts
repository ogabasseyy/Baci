const VARIANT_COLOR_ATTRIBUTE_KEYS = ['color', 'Colour', 'colour'] as const;

/** Reads a selectable color from the exact axis spellings supported by the storefront. */
export function getMcpVariantColorValue(
  attributes: Record<string, unknown> | null | undefined
): string | undefined {
  for (const key of VARIANT_COLOR_ATTRIBUTE_KEYS) {
    const value = attributes?.[key];
    if (typeof value === 'string' && value.trim()) return value;
  }

  return undefined;
}

/** Renders a variant attribute for human-readable summaries, dropping non-primitive JSON that would stringify as "[object Object]". */
export function getMcpVariantAttributeTextValue(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return undefined;
  if (!value) return undefined;
  return String(value);
}
