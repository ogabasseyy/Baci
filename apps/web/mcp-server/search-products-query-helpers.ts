import { normalizeCanonicalProductCondition } from '@baci/shared/lib';
import { storefrontProductFilters } from '../src/lib/storefront-product-filters';

export type McpSearchProductRow = {
  id: string;
  available_conditions?: unknown;
  brand?: string | null;
  category?: string | null;
  compare_at_price?: number | null;
  condition?: string | null;
  condition_detail?: string | null;
  created_at?: string | null;
  has_condition_offers?: boolean | null;
  has_variants?: boolean | null;
  images?: unknown;
  manage_stock?: boolean | null;
  name?: string | null;
  price?: number | null;
  slug?: string | null;
  stock_quantity?: number | null;
  updated_at?: string | null;
};

export type RankedSearchProductRow = {
  product_id?: unknown;
  total_count?: unknown;
};

function getConditionRawAliases(condition: string) {
  const normalized = normalizeCanonicalProductCondition(condition);

  if (!normalized) {
    return undefined;
  }

  if (normalized === 'open_box') {
    return { normalized, rawConditions: ['open_box', 'refurbished'] };
  }

  if (normalized === 'used') {
    return { normalized, rawConditions: ['used', 'uk_used'] };
  }

  return { normalized, rawConditions: ['new'] };
}

export function getConditionPrefilterClauses(condition: string) {
  const aliases = getConditionRawAliases(condition);

  if (!aliases) {
    return [];
  }

  const clauses = new Set<string>();
  for (const rawCondition of aliases.rawConditions) {
    clauses.add(`condition.eq.${rawCondition}`);
    clauses.add(`available_conditions.cs.{${rawCondition}}`);
  }

  if (aliases.normalized === 'new' || aliases.normalized === 'used') {
    clauses.add('has_condition_offers.eq.true');
  }

  return Array.from(clauses);
}

function toConditionSource(product: Record<string, unknown>) {
  return {
    available_conditions: product.available_conditions,
    condition:
      typeof product.condition === 'string' ? product.condition : null,
    has_condition_offers:
      typeof product.has_condition_offers === 'boolean'
        ? product.has_condition_offers
        : null,
  };
}

export function matchesRowConditionFamily(
  product: Record<string, unknown>,
  condition: string | undefined
) {
  if (!condition) {
    return true;
  }

  return storefrontProductFilters.matchesStorefrontConditionFilter(
    { condition: toConditionSource(product).condition },
    condition
  );
}

export function matchesConditionFamily(
  product: Record<string, unknown>,
  condition: string | undefined
) {
  if (!condition) {
    return true;
  }

  return storefrontProductFilters.matchesStorefrontConditionFilter(
    toConditionSource(product),
    condition
  );
}

export function extractRankedProductIds(rows: RankedSearchProductRow[]) {
  return rows
    .map((row) =>
      typeof row.product_id === 'string' ? row.product_id : null
    )
    .filter((id): id is string => Boolean(id));
}

export function getRankedProductTotal(rows: RankedSearchProductRow[]) {
  const rawCount = rows[0]?.total_count;

  if (typeof rawCount === 'number') {
    return rawCount;
  }

  if (typeof rawCount === 'string') {
    return Number.parseInt(rawCount, 10) || 0;
  }

  return rows.length;
}

export function toRankedSearchProductRows(
  data: unknown
): RankedSearchProductRow[] {
  if (!Array.isArray(data)) {
    return [];
  }

  return data.filter((row): row is RankedSearchProductRow => {
    if (!row || typeof row !== 'object' || !('product_id' in row)) {
      return false;
    }

    const { product_id: productId, total_count: totalCount } =
      row as RankedSearchProductRow;

    return (
      typeof productId === 'string' &&
      (totalCount === undefined ||
        totalCount === null ||
        typeof totalCount === 'number' ||
        typeof totalCount === 'string')
    );
  });
}

export function toMcpSearchProductRows(data: unknown): McpSearchProductRow[] {
  if (!Array.isArray(data)) {
    return [];
  }

  return data.filter(
    (row): row is McpSearchProductRow =>
      Boolean(row) &&
      typeof row === 'object' &&
      'id' in row &&
      typeof row.id === 'string'
  );
}

export function matchesMcpPostHydrationFilters(
  product: McpSearchProductRow,
  filters: {
    brand?: string;
    category?: string;
    condition?: string;
  }
) {
  if (
    filters.category &&
    !String(product.category ?? '')
      .toLowerCase()
      .includes(filters.category.toLowerCase())
  ) {
    return false;
  }

  if (
    filters.brand &&
    !String(product.brand ?? '')
      .toLowerCase()
      .includes(filters.brand.toLowerCase())
  ) {
    return false;
  }

  return matchesConditionFamily(product, filters.condition);
}

/** Infer a handset category only when the query clearly names a phone itself. */
export function inferSmartphoneCategory(
  query: string | undefined,
  explicitCategory: string | undefined
): 'Smartphones' | undefined {
  if (!query || explicitCategory) return undefined;
  const handset = /\b(?:iphones?|smartphones?|mobile phones?|phones?)\b/i.exec(query);
  if (!handset) return undefined;
  const prefix = query.slice(0, handset.index);
  if (/\b(?:for|with|and|or|cases?|covers?|chargers?|screen protectors?|stands?|holders?|mounts?|tripods?|lenses?|pouches?|wallets?|earbuds?)\b|&/i.test(prefix)) return undefined;

  let remainder = query.slice(handset.index + handset[0].length).trim().replace(/[?.!,]+$/, '').trim();
  remainder = remainder.replace(/^\d{1,3}[a-z]?(?:\s+(?:pro|max|plus|mini|ultra)){0,2}(?=\s|$)/i, '').trim();
  remainder = remainder.replace(/^\d+(?:GB|TB)(?=\s|$)/i, '').trim();
  const priceOnly = /^(?:under|below|from|at)\s+[₦$]?\d[\d,.]*(?:\s*(?:ngn|naira))?$/i.test(remainder) ||
    /^between\s+[₦$]?\d[\d,.]*\s+and\s+[₦$]?\d[\d,.]*$/i.test(remainder);
  return !remainder || priceOnly ? 'Smartphones' : undefined;
}
