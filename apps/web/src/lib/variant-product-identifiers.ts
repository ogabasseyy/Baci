export interface ProductManufacturerIdentifiers {
  gtin?: string | null;
  mpn?: string | null;
}

function normalizeIdentifier(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  return value.trim() || undefined;
}

/** Normalize known parent identifiers for standalone product representations. */
export function normalizeParentProductIdentifiers(
  parent: ProductManufacturerIdentifiers
): { gtin?: string; mpn?: string } {
  return {
    gtin: normalizeIdentifier(parent.gtin),
    mpn: normalizeIdentifier(parent.mpn),
  };
}

/**
 * Resolve only usable string identifiers explicitly present on a variant.
 * Numeric values are ignored so parsing cannot erase leading-zero GTIN text.
 */
export function resolveVariantProductIdentifiers(
  attributes: Readonly<Record<string, unknown>> | null | undefined
): { gtin?: string; mpn?: string } {
  const identifiers: { gtin?: string; mpn?: string } = {};
  for (const [key, value] of Object.entries(attributes ?? {})) {
    const normalizedKey = key
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_');
    if (normalizedKey !== 'gtin' && normalizedKey !== 'mpn') {
      continue;
    }

    const normalizedValue = normalizeIdentifier(value);
    if (normalizedValue) {
      identifiers[normalizedKey] = normalizedValue;
    }
  }

  return identifiers;
}
