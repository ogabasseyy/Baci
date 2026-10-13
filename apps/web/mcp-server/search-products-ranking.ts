import { normalizeCanonicalProductCondition } from '@baci/shared/lib';

export const POST_FILTER_RESULT_PAGE_SIZE = 100;
export const MAX_POST_FILTER_RESULT_PAGES = 5;

interface McpSearchProductsArgs {
  brand?: string;
  category?: string;
  condition?: 'new' | 'used' | 'open_box' | 'refurbished' | string;
  max_price?: number;
  min_price?: number;
  sort?: 'price_asc' | 'price_desc' | 'newest' | 'relevance';
}

export function buildSearchProductsV2RpcArgs({
  args,
  forcePostFilterBuffer = false,
  limit,
  merchantId,
  sanitizedQuery,
  offset = 0,
}: {
  args: McpSearchProductsArgs;
  forcePostFilterBuffer?: boolean;
  limit: number;
  merchantId: string;
  sanitizedQuery: string;
  offset?: number;
}) {
  const hasConditionFamilyFilter = Boolean(
    normalizeCanonicalProductCondition(args.condition)
  );

  return {
    brand_filter: null,
    category_id_filter: null,
    // search_products_v2 condition_filter is an exact DB-value filter. MCP
    // condition inputs are storefront family filters (`open_box` also covers
    // legacy `refurbished` rows), so condition narrowing happens after ranked
    // hydration rather than inside the RPC.
    condition_filter: null,
    max_price_filter: args.max_price ?? null,
    merchant_id_param: merchantId,
    min_price_filter: args.min_price ?? null,
    min_rating_filter: null,
    parent_only: false,
    result_limit:
      forcePostFilterBuffer || args.brand || args.category || hasConditionFamilyFilter
        ? POST_FILTER_RESULT_PAGE_SIZE
        : limit,
    result_offset: offset,
    search_query: sanitizedQuery,
    sort_by: args.sort ?? 'relevance',
    status_filter: 'active',
    stock_filter: null,
  };
}

export function orderRowsByRankedProductIds<T extends { id: string }>(
  rows: T[],
  rankedProductIds: string[]
) {
  const order = new Map(
    rankedProductIds.map((id, index) => [id, index] as const)
  );

  return [...rows].sort(
    (a, b) =>
      (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(b.id) ?? Number.MAX_SAFE_INTEGER)
  );
}
