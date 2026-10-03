export interface ProductManufacturerIdentifiers {
  gtin?: string | null;
  mpn?: string | null;
}

/** Prefer populated variant manufacturer identifiers, retaining parent fallback. */
export function resolveVariantProductIdentifiers(
  attributes: Readonly<Record<string, unknown>> | null | undefined,
  parent: ProductManufacturerIdentifiers
): { gtin?: string; mpn?: string } {
  const normalizedAttributes: { gtin?: unknown; mpn?: unknown } = {};
  for (const [key, value] of Object.entries(attributes ?? {})) {
    const normalizedKey = key
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_');
    if (normalizedKey === 'gtin' || normalizedKey === 'mpn') {
      const normalizedValue =
        typeof value === 'string'
          ? value.trim()
          : typeof value === 'number' && Number.isFinite(value)
            ? value
            : '';
      if (normalizedValue !== '') {
        normalizedAttributes[normalizedKey] = normalizedValue;
      }
    }
  }

  const resolve = (
    variantValue: unknown,
    parentValue: string | null | undefined
  ) => {
    const normalizedVariantValue =
      typeof variantValue === 'string' ? variantValue.trim() : '';
    return normalizedVariantValue || parentValue || undefined;
  };

  return {
    gtin: resolve(normalizedAttributes.gtin, parent.gtin),
    mpn: resolve(normalizedAttributes.mpn, parent.mpn),
  };
}
