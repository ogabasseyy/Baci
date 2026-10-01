import type { SupabaseClient } from '@supabase/supabase-js';
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
  getRankedProductTotal,
  matchesMcpPostHydrationFilters,
  type McpSearchProductRow,
  toMcpSearchProductRows,
  toRankedSearchProductRows,
} from './search-products-query-helpers';

export type SearchProductsArgs = {
  brand?: string;
  category?: string;
  condition?: string;
  limit?: number;
  max_price?: number;
  min_price?: number;
  query?: string;
  sort?: 'price_asc' | 'price_desc' | 'newest' | 'relevance';
};

export async function loadRankedMcpProducts({
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
        forcePostFilterBuffer: needsCandidateScan,
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
