export interface ProductManufacturerIdentifiers {
  gtin?: string | null;
  mpn?: string | null;
}

/**
 * Trim identifier text without validating its shape. GTIN digit/length rules
 * are intentionally not enforced here: dropping merchant-provided values on
 * a format mismatch risks worse data loss than passing them through, and
 * the catalogs validate GTINs themselves with diagnostics. MPNs are
 * free-text by nature. GTIN format validation is a catalog-data-quality
 * follow-up, out of scope for this parity/trim fix.
 */
function normalizeIdentifier(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  return value.trim() || undefined;
}

/** Normalize known parent identifiers for standalone product representations. */
function normalizeParentProductIdentifiers(
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
 * Accepted keys are case/whitespace/hyphen variants of `gtin` and `mpn`
 * only; `ean`/`upc`/`isbn` keys are not resolved (a possible follow-up).
 * When several alias spellings of one field hold distinct valid values, the
 * last valid value in attribute order wins; blank and non-string values
 * never overwrite a resolved identifier.
 */
function resolveVariantProductIdentifiers(
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

export const productManufacturerIdentifiers = {
  normalizeParentProductIdentifiers,
  resolveVariantProductIdentifiers,
};
