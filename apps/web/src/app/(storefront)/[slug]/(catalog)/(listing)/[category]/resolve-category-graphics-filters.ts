const MAX_GRAPHICS_FILTERS = 8;
const MAX_GRAPHICS_FILTER_LENGTH = 120;

/**
 * Accept only bounded, full-category facet values. Besides keeping URLs tidy,
 * intersecting with the server-derived options prevents arbitrary query-string
 * values from creating high-cardinality product-cache entries.
 */
export function resolveCategoryGraphicsFilters(
  rawGraphics: string | string[] | undefined,
  availableGraphics: string[]
): string[] {
  const requested = Array.isArray(rawGraphics)
    ? rawGraphics
    : rawGraphics
      ? [rawGraphics]
      : [];
  const available = new Set(availableGraphics);

  return Array.from(
    new Set(
      requested
        .map((value) => value.trim())
        .filter(
          (value) =>
            value.length > 0 &&
            value.length <= MAX_GRAPHICS_FILTER_LENGTH &&
            available.has(value)
        )
    )
  )
    .sort((left, right) => left.localeCompare(right))
    .slice(0, MAX_GRAPHICS_FILTERS);
}
