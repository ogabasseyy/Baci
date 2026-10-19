export type CatalogFilterQuery = {
  eq: (column: string, value: string | number) => CatalogFilterQuery;
  gte: (column: string, value: number) => CatalogFilterQuery;
  lte: (column: string, value: number) => CatalogFilterQuery;
  order: (
    column: string,
    options: Record<string, unknown>
  ) => CatalogFilterQuery;
  or: (filters: string) => CatalogFilterQuery;
  range: (
    from: number,
    to: number
  ) => Promise<{ data: unknown[] | null; error: unknown | null }>;
};

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() && value.trim() !== 'all'
    ? value.trim()
    : null;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function escapePostgrestValue(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll(',', '\\,');
}

export function applyUcpCatalogSearchFilters(
  query: CatalogFilterQuery,
  filters: Record<string, unknown> | undefined
): CatalogFilterQuery {
  if (!filters) return query;
  let filteredQuery = query;

  const category = asNonEmptyString(filters.category);
  if (category) {
    const escapedCategory = escapePostgrestValue(category);
    filteredQuery = filteredQuery.or(
      `category.eq.${escapedCategory},categories.slug.eq.${escapedCategory}`
    );
  }

  const brand = asNonEmptyString(filters.brand);
  if (brand) filteredQuery = filteredQuery.eq('brand', brand);

  const condition = asNonEmptyString(filters.condition);
  if (condition) filteredQuery = filteredQuery.eq('condition', condition);

  const minPrice = asFiniteNumber(filters.min_price ?? filters.minPrice);
  if (minPrice !== null) filteredQuery = filteredQuery.gte('price', minPrice);

  const maxPrice = asFiniteNumber(filters.max_price ?? filters.maxPrice);
  if (maxPrice !== null) filteredQuery = filteredQuery.lte('price', maxPrice);

  const minRating = asFiniteNumber(filters.min_rating ?? filters.minRating);
  if (minRating !== null)
    filteredQuery = filteredQuery.gte('average_rating', minRating);

  return filteredQuery;
}
