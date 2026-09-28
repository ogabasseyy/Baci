import type { SupabaseClient } from '@supabase/supabase-js';
import { inferSmartphoneCategory } from './infer-smartphone-category';
import { DISCOVERY_PRODUCT_PROJECTION } from './discovery-product-projection';
import { matchesSingleWordDiscoveryQuery } from './search-products-relevance';
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
  priceScanComplete: boolean;
  products: McpSearchProductRow[];
  sanitizedQuery: string | undefined;
  sawRankedRows: boolean;
};

async function loadRankedMcpProducts({
  args,
  hasPostHydrationFilters,
  limit,
  priceSensitive,
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
  priceSensitive: boolean;
  merchantId: string;
  sanitizedBrand: string | undefined;
  sanitizedCategory: string | undefined;
  sanitizedCondition: string | undefined;
  sanitizedQuery: string;
  supabase: SupabaseClient;
}) {
  const products: McpSearchProductRow[] = [];
  const candidateLimit = priceSensitive
    ? MAX_POST_FILTER_RESULT_PAGES * POST_FILTER_RESULT_PAGE_SIZE
    : limit;
  const needsCandidateScan = hasPostHydrationFilters || priceSensitive;
  let pageOffset = 0;
  let totalRankedMatches = Number.POSITIVE_INFINITY;
  let sawRankedRows = false;
  let pagesRead = 0;
  let scanExhausted = false;

  while (
    pagesRead < MAX_POST_FILTER_RESULT_PAGES &&
    pageOffset < totalRankedMatches &&
    (!needsCandidateScan || products.length < candidateLimit)
  ) {
    const ranked = await supabase.rpc(
      'search_products_v2',
      buildSearchProductsV2RpcArgs({
        args: {
          brand: sanitizedBrand,
          category: sanitizedCategory,
          condition: sanitizedCondition,
          max_price: priceSensitive ? undefined : args.max_price,
          min_price: priceSensitive ? undefined : args.min_price,
          sort: priceSensitive && (args.sort === 'price_asc' || args.sort === 'price_desc')
            ? 'relevance'
            : args.sort,
        },
        forcePostFilterBuffer: priceSensitive,
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
      scanExhausted = true;
      break;
    }

    sawRankedRows = true;
    const reportedTotal = getRankedProductTotal(rankedRows);
    totalRankedMatches =
      reportedTotal > 0 ? reportedTotal : pageOffset + rankedProductIds.length;
    if (pageOffset + rankedProductIds.length >= totalRankedMatches) {
      scanExhausted = true;
    }

    const { data: productRows, error } = await supabase
      .from('products')
      .select(DISCOVERY_PRODUCT_PROJECTION)
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
        }) && matchesSingleWordDiscoveryQuery(product, sanitizedQuery, sanitizedCategory)
      );
    }

    products.push(...pageProducts);

    if (!needsCandidateScan) {
      break;
    }

    pageOffset += POST_FILTER_RESULT_PAGE_SIZE;
  }

  return {
    products: products.slice(0, candidateLimit),
    priceScanComplete: !priceSensitive || scanExhausted || pagesRead < MAX_POST_FILTER_RESULT_PAGES,
    sawRankedRows,
  };
}

async function loadCatalogMcpProducts({
  args,
  limit,
  priceSensitive,
  merchantId,
  sanitizedBrand,
  sanitizedCategory,
  sanitizedCondition,
  supabase,
}: {
  args: SearchProductsArgs;
  limit: number;
  priceSensitive: boolean;
  merchantId: string;
  sanitizedBrand: string | undefined;
  sanitizedCategory: string | undefined;
  sanitizedCondition: string | undefined;
  supabase: SupabaseClient;
}) {
  const buildCatalogQuery = (
    pageOffset?: number,
    pageSize = POST_FILTER_RESULT_PAGE_SIZE
  ) => {
    let query = supabase
      .from('products')
      .select(DISCOVERY_PRODUCT_PROJECTION)
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
    if (!priceSensitive && args.min_price !== undefined) {
      query = query.gte('price', args.min_price);
    }
    if (!priceSensitive && args.max_price !== undefined) {
      query = query.lte('price', args.max_price);
    }

    if (!priceSensitive && args.sort === 'price_asc') {
      query = query.order('price', { ascending: true });
    } else if (!priceSensitive && args.sort === 'price_desc') {
      query = query.order('price', { ascending: false });
    } else if (args.sort === 'newest') {
      query = query.order('created_at', { ascending: false });
    } else {
      query = query.order('stock_quantity', { ascending: false });
    }
    query = query.order('id', { ascending: true });

    if (pageOffset !== undefined) {
      return query.range(
        pageOffset,
        pageOffset + pageSize - 1
      );
    }

    return query.limit(limit);
  };

  if (!sanitizedCondition && !priceSensitive) {
    const { data: productRows, error } = await buildCatalogQuery();
    if (error) throw error;
    return { products: toMcpSearchProductRows(productRows), priceScanComplete: true };
  }

  let pageOffset = 0;
  const products: McpSearchProductRow[] = [];
  const candidateLimit = priceSensitive
    ? MAX_POST_FILTER_RESULT_PAGES * POST_FILTER_RESULT_PAGE_SIZE
    : limit;
  let pagesRead = 0;
  let scanExhausted = false;

  while (
    pagesRead < MAX_POST_FILTER_RESULT_PAGES &&
    products.length < candidateLimit
  ) {
    const { data: productRows, error } = await buildCatalogQuery(pageOffset);
    if (error) throw error;
    pagesRead += 1;

    const pageRows = productRows || [];
    if (pageRows.length === 0) {
      scanExhausted = true;
      break;
    }

    products.push(
      ...toMcpSearchProductRows(pageRows).filter((product) =>
        matchesConditionFamily(product, sanitizedCondition)
      )
    );

    if (pageRows.length < POST_FILTER_RESULT_PAGE_SIZE) {
      scanExhausted = true;
      break;
    }

    pageOffset += POST_FILTER_RESULT_PAGE_SIZE;
  }

  if (
    priceSensitive &&
    !scanExhausted &&
    pagesRead >= MAX_POST_FILTER_RESULT_PAGES
  ) {
    const { data: nextPage, error } = await buildCatalogQuery(pageOffset, 1);
    if (error) throw error;
    scanExhausted = !nextPage || nextPage.length === 0;
  }

  return {
    products: products.slice(0, candidateLimit),
    priceScanComplete: !priceSensitive || scanExhausted || pagesRead < MAX_POST_FILTER_RESULT_PAGES,
  };
}

export async function loadMcpSearchProducts({
  args,
  merchantId,
  sanitizeString,
  supabase,
}: LoadMcpSearchProductsInput): Promise<LoadMcpSearchProductsResult> {
  const sanitizedQuery = args.query ? sanitizeString(args.query, 100) : undefined;
  const sanitizedBrand = args.brand ? sanitizeString(args.brand, 50) : undefined;
  const sanitizedCategory = args.category
    ? sanitizeString(args.category, 50)
    : inferSmartphoneCategory(sanitizedQuery, args.category);
  const sanitizedCondition = args.condition
    ? sanitizeString(args.condition, 50)
    : undefined;
  const limit = Math.min(Math.max(args.limit || 10, 1), 20);
  const hasPostHydrationFilters = Boolean(
    sanitizedBrand || sanitizedCategory || sanitizedCondition ||
    (sanitizedQuery && /^[a-z]{3,}$/i.test(sanitizedQuery))
  );
  const priceSensitive = args.min_price !== undefined ||
    args.max_price !== undefined ||
    args.sort === 'price_asc' ||
    args.sort === 'price_desc';

  if (sanitizedQuery) {
    const ranked = await loadRankedMcpProducts({
      args,
      hasPostHydrationFilters,
      limit,
      priceSensitive,
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
    ...(await loadCatalogMcpProducts({
      args,
      limit,
      priceSensitive,
      merchantId,
      sanitizedBrand,
      sanitizedCategory,
      sanitizedCondition,
      supabase,
    })),
    sawRankedRows: false,
    sanitizedQuery,
  };
}
