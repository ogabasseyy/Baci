import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildSearchProductsV2RpcArgs,
  MAX_POST_FILTER_RESULT_PAGES,
  orderRowsByRankedProductIds,
  POST_FILTER_RESULT_PAGE_SIZE,
} from './search-products-ranking';
import {
  extractRankedProductIds,
  getConditionPrefilterClauses,
  getRankedProductTotal,
  matchesConditionFamily,
  matchesMcpPostHydrationFilters,
  type McpSearchProductRow,
  toMcpSearchProductRows,
  toRankedSearchProductRows,
} from './search-products-query-helpers';

type SearchProductsArgs = {
  brand?: string;
  category?: string;
  condition?: string;
  limit?: number;
  max_price?: number;
  min_price?: number;
  query?: string;
  sort?: 'price_asc' | 'price_desc' | 'newest' | 'relevance';
};

type LoadMcpSearchProductsInput = {
  args: SearchProductsArgs;
  merchantId: string;
  sanitizeString: (input: string, maxLength?: number) => string;
  supabase: SupabaseClient;
};

export type LoadMcpSearchProductsResult = {
  limit: number;
  products: McpSearchProductRow[];
  sanitizedQuery: string | undefined;
  sawRankedRows: boolean;
};

const productSelect =
  'id, name, slug, price, compare_at_price, images, condition, condition_detail, available_conditions, has_condition_offers, brand, category, manage_stock, stock_quantity, has_variants, updated_at, created_at';

async function loadRankedMcpProducts({
  args,
  hasPostHydrationFilters,
  limit,
  merchantId,
  sanitizedBrand,
  sanitizedCategory,
  sanitizedCondition,
  sanitizedQuery,
  supabase,
}: {
  args: SearchProductsArgs;
  hasPostHydrationFilters: boolean;
  limit: number;
  merchantId: string;
  sanitizedBrand: string | undefined;
  sanitizedCategory: string | undefined;
  sanitizedCondition: string | undefined;
  sanitizedQuery: string;
  supabase: SupabaseClient;
}) {
  const products: McpSearchProductRow[] = [];
  let pageOffset = 0;
  let totalRankedMatches = Number.POSITIVE_INFINITY;
  let sawRankedRows = false;
  let pagesRead = 0;

  while (
    pagesRead < MAX_POST_FILTER_RESULT_PAGES &&
    pageOffset < totalRankedMatches &&
    (!hasPostHydrationFilters || products.length < limit)
  ) {
    const ranked = await supabase.rpc(
      'search_products_v2',
      buildSearchProductsV2RpcArgs({
        args: {
          brand: sanitizedBrand,
          category: sanitizedCategory,
          condition: sanitizedCondition,
          max_price: args.max_price,
          min_price: args.min_price,
          sort: args.sort,
        },
        limit,
        merchantId,
        offset: pageOffset,
        sanitizedQuery,
      })
    );

    if (ranked.error) throw ranked.error;
    pagesRead += 1;

    const rankedRows = toRankedSearchProductRows(ranked.data);
    const rankedProductIds = extractRankedProductIds(rankedRows);

    if (rankedProductIds.length === 0) {
      break;
    }

    sawRankedRows = true;
    const reportedTotal = getRankedProductTotal(rankedRows);
    totalRankedMatches =
      reportedTotal > 0 ? reportedTotal : pageOffset + rankedProductIds.length;

    const { data: productRows, error } = await supabase
      .from('products')
      .select(productSelect)
      .eq('merchant_id', merchantId)
      .eq('status', 'active')
      .in('id', rankedProductIds);

    if (error) throw error;

    let pageProducts = orderRowsByRankedProductIds(
      toMcpSearchProductRows(productRows),
      rankedProductIds
    );

    if (hasPostHydrationFilters) {
      pageProducts = pageProducts.filter((product) =>
        matchesMcpPostHydrationFilters(product, {
          brand: sanitizedBrand,
          category: sanitizedCategory,
          condition: sanitizedCondition,
        })
      );
    }

    products.push(...pageProducts);

    if (!hasPostHydrationFilters) {
      break;
    }

    pageOffset += POST_FILTER_RESULT_PAGE_SIZE;
  }

  return { products: products.slice(0, limit), sawRankedRows };
}

async function loadCatalogMcpProducts({
  args,
  limit,
  merchantId,
  sanitizedBrand,
  sanitizedCategory,
  sanitizedCondition,
  supabase,
}: {
  args: SearchProductsArgs;
  limit: number;
  merchantId: string;
  sanitizedBrand: string | undefined;
  sanitizedCategory: string | undefined;
  sanitizedCondition: string | undefined;
  supabase: SupabaseClient;
}) {
  const buildCatalogQuery = (pageOffset?: number) => {
    let query = supabase
      .from('products')
      .select(productSelect)
      .eq('merchant_id', merchantId)
      .eq('status', 'active');

    if (sanitizedCondition) {
      const conditionClauses = getConditionPrefilterClauses(sanitizedCondition);
      if (conditionClauses.length > 0) {
        query = query.or(conditionClauses.join(','));
      }
    }
    if (sanitizedCategory) {
      query = query.ilike('category', `%${sanitizedCategory}%`);
    }
    if (sanitizedBrand) {
      query = query.ilike('brand', `%${sanitizedBrand}%`);
    }
    if (args.min_price !== undefined) {
      query = query.gte('price', args.min_price);
    }
    if (args.max_price !== undefined) {
      query = query.lte('price', args.max_price);
    }

    if (args.sort === 'price_asc') {
      query = query.order('price', { ascending: true });
    } else if (args.sort === 'price_desc') {
      query = query.order('price', { ascending: false });
    } else if (args.sort === 'newest') {
      query = query.order('created_at', { ascending: false });
    } else {
      query = query.order('stock_quantity', { ascending: false });
    }

    if (pageOffset !== undefined) {
      return query.range(
        pageOffset,
        pageOffset + POST_FILTER_RESULT_PAGE_SIZE - 1
      );
    }

    return query.limit(limit);
  };

  if (!sanitizedCondition) {
    const { data: productRows, error } = await buildCatalogQuery();
    if (error) throw error;
    return toMcpSearchProductRows(productRows);
  }

  let pageOffset = 0;
  const products: McpSearchProductRow[] = [];
  let pagesRead = 0;

  while (
    pagesRead < MAX_POST_FILTER_RESULT_PAGES &&
    products.length < limit
  ) {
    const { data: productRows, error } = await buildCatalogQuery(pageOffset);
    if (error) throw error;
    pagesRead += 1;

    const pageRows = productRows || [];
    if (pageRows.length === 0) {
      break;
    }

    products.push(
      ...toMcpSearchProductRows(pageRows).filter((product) =>
        matchesConditionFamily(product, sanitizedCondition)
      )
    );

    if (pageRows.length < POST_FILTER_RESULT_PAGE_SIZE) {
      break;
    }

    pageOffset += POST_FILTER_RESULT_PAGE_SIZE;
  }

  return products.slice(0, limit);
}

export async function loadMcpSearchProducts({
  args,
  merchantId,
  sanitizeString,
  supabase,
}: LoadMcpSearchProductsInput): Promise<LoadMcpSearchProductsResult> {
  const sanitizedQuery = args.query ? sanitizeString(args.query, 100) : undefined;
  const sanitizedBrand = args.brand ? sanitizeString(args.brand, 50) : undefined;
  const inferredCategory = !args.category && sanitizedQuery &&
    /\b(?:smartphones?|mobile phones?|phones?)\b(?=\s*(?:$|[?.!,]|\b(?:under|below|between|for|with|priced|costing|from|at|that|which|in)\b))/i.test(sanitizedQuery) &&
    !/\b(?:tablets?|ipads?|laptops?|computers?|cases?|covers?|accessories|chargers?|screen protectors?|repairs?|parts?|batteries|cables?)\b/i.test(sanitizedQuery)
      ? 'Smartphones'
      : undefined;
  const sanitizedCategory = args.category
    ? sanitizeString(args.category, 50)
    : inferredCategory;
  const sanitizedCondition = args.condition
    ? sanitizeString(args.condition, 50)
    : undefined;
  const limit = Math.min(Math.max(args.limit || 10, 1), 20);
  const hasPostHydrationFilters = Boolean(
    sanitizedBrand || sanitizedCategory || sanitizedCondition
  );

  if (sanitizedQuery) {
    const ranked = await loadRankedMcpProducts({
      args,
      hasPostHydrationFilters,
      limit,
      merchantId,
      sanitizedBrand,
      sanitizedCategory,
      sanitizedCondition,
      sanitizedQuery,
      supabase,
    });

    return { limit, sanitizedQuery, ...ranked };
  }

  return {
    limit,
    products: await loadCatalogMcpProducts({
      args,
      limit,
      merchantId,
      sanitizedBrand,
      sanitizedCategory,
      sanitizedCondition,
      supabase,
    }),
    sanitizedQuery,
    sawRankedRows: false,
  };
}
