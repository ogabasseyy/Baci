export interface ProductManufacturerIdentifiers {
  gtin?: string | null;
  mpn?: string | null;
}

/**
 * Prefer nonblank variant identifier strings after Google Merchant key
 * normalization. Parent fallback is retained for compatibility, then trimmed
 * so schema and feed consumers emit consistent identifiers; that fallback is
 * intentionally different from Google's omit-unknown policy.
 */
export function resolveVariantProductIdentifiers(
  attributes: Readonly<Record<string, unknown>> | null | undefined,
  parent: ProductManufacturerIdentifiers
): { gtin?: string; mpn?: string } {
  const normalizedAttributes: { gtin?: string; mpn?: string } = {};
  for (const [key, value] of Object.entries(attributes ?? {})) {
    const normalizedKey = key
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_');
    if (normalizedKey === 'gtin' || normalizedKey === 'mpn') {
      // Ignore unusable values so duplicate numeric/junk keys cannot erase a valid ID.
      const normalizedValue = typeof value === 'string' ? value.trim() : '';
      if (normalizedValue) {
        normalizedAttributes[normalizedKey] = normalizedValue;
      }
    }
  }

  const resolve = (
    variantValue: string | undefined,
    parentValue: string | null | undefined
  ) => {
    const normalizedParentValue = parentValue?.trim();
    return variantValue || normalizedParentValue || undefined;
  };

  return {
    gtin: resolve(normalizedAttributes.gtin, parent.gtin),
    mpn: resolve(normalizedAttributes.mpn, parent.mpn),
  };
}
