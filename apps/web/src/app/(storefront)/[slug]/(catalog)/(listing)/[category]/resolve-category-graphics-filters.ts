import {
  MAX_CATEGORY_GRAPHICS_VALUE_LENGTH,
  normalizeCategoryGraphicsValue,
} from '@/lib/category-page-graphics-query';

const MAX_GRAPHICS_FILTERS = 8;

interface ResolveCategoryGraphicsFiltersOptions {
  /**
   * Trusted callers (curated hub pages) pass facet-derived values, not raw
   * query strings, so the request-cardinality cap does not apply. Values are
   * still intersected with the facet allowlist and length-checked; the set
   * stays bounded by distinct inventory values.
   */
  trustedSource?: boolean;
}

/**
 * Accept only bounded, full-category facet values. Besides keeping URLs tidy,
 * intersecting with the server-derived options prevents arbitrary query-string
 * values from creating high-cardinality product-cache entries.
 */
export function resolveCategoryGraphicsFilters(
  rawGraphics: string | string[] | undefined,
  availableGraphics: string[],
  options: ResolveCategoryGraphicsFiltersOptions = {}
): string[] {
  const requested = Array.isArray(rawGraphics)
    ? rawGraphics
    : rawGraphics
      ? [rawGraphics]
      : [];
  const available = new Set(availableGraphics);

  const resolved = Array.from(
    new Set(
      requested
        .map((value) => normalizeCategoryGraphicsValue(value))
        .filter(
          (value) =>
            value.length > 0 &&
            value.length <= MAX_CATEGORY_GRAPHICS_VALUE_LENGTH &&
            available.has(value)
        )
    )
  ).sort((left, right) => left.localeCompare(right));

  return options.trustedSource
    ? resolved
    : resolved.slice(0, MAX_GRAPHICS_FILTERS);
}
