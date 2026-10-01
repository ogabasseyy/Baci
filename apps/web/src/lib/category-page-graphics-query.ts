/**
 * GPU facet query decoration for category product reads.
 *
 * Facets expose trimmed `product_key_specs.gpu` values and filter predicates
 * must use the same form; the stored side is normalized at rest by migration
 * `20260922120000_normalize_product_key_specs_gpu` (backfill + trim
 * trigger), so trimmed request values exact-match the column.
 */

/**
 * ASCII whitespace trims identically in JavaScript and PostgreSQL
 * (`regexp_replace` with this class), unlike `String.trim()`/`btrim()` which
 * disagree on tabs, newlines, and Unicode spaces. Every graphics comparison
 * must go through this normalizer so advertised facet values always
 * exact-match the stored column.
 */
const GRAPHICS_TRIM_PATTERN = /^[\t\n\f\r\v ]+|[\t\n\f\r\v ]+$/g;

/**
 * GPU labels longer than this are never selectable: the filter resolver
 * discards them to bound cache cardinality, so facet construction must not
 * advertise them either.
 */
export const MAX_CATEGORY_GRAPHICS_VALUE_LENGTH = 120;

export function normalizeCategoryGraphicsValue(value: string): string {
  return value.replace(GRAPHICS_TRIM_PATTERN, '');
}

export function normalizeCategoryGraphicsValues(
  values: string[] | undefined
): string[] {
  return (values ?? [])
    .map((value) => normalizeCategoryGraphicsValue(value))
    .filter((value) => value.length > 0);
}

/** Inner-join fragment selecting the gpu relation when filtering. */
export function buildCategoryGraphicsJoin(graphics: string[]): string {
  return graphics.length > 0 ? ', product_key_specs!inner(gpu)' : '';
}

interface GraphicsFilterableQuery {
  in(column: string, values: string[]): unknown;
}

/**
 * Applies the exact-match gpu predicate; a no-op when unfiltered.
 * PostgREST builders accumulate filters on `this`, so the call is made for
 * effect and the original query is returned untouched type-wise.
 */
export function applyCategoryGraphicsPredicate<TQuery>(
  query: TQuery,
  graphics: string[]
): TQuery {
  if (graphics.length === 0) return query;
  (query as TQuery & GraphicsFilterableQuery).in(
    'product_key_specs.gpu',
    graphics
  );
  return query;
}
