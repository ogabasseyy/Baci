import { cookies } from 'next/headers';
import { type NormalizedProduct, normalizeProduct } from './normalize-product';
import { storefrontProductFilters } from './storefront-product-filters';
import { STOREFRONT_PRODUCTS_COMPACT_SELECT } from './storefront-products-select';
import {
  clampSearchLimit,
  collectRankedSearchProductIds,
  normalizeSearchOffset,
  type StorefrontSearchFilters,
  type StorefrontSearchResult,
  type StorefrontSearchSort,
  searchStorefrontProducts,
} from './storefront-search';
import { scheduleSearchAnalyticsInsert } from './storefront-search-analytics';
import { createPublicClient } from './supabase/public';
import { createClient } from './supabase/server';

export interface StorefrontSearchProductsPage extends StorefrontSearchResult {
  products: NormalizedProduct[];
}

async function hydrateRankedStorefrontProducts(args: {
  supabase: ReturnType<typeof createPublicClient>;
  merchantId: string;
  productIds: string[];
}): Promise<NormalizedProduct[]> {
  const { data, error } = await args.supabase
    .from('products')
    .select(STOREFRONT_PRODUCTS_COMPACT_SELECT)
    .in('id', args.productIds)
    .eq('merchant_id', args.merchantId)
    .eq('status', 'active');

  if (error) {
    throw error;
  }

  const mapped = (data ?? []).map((row) => normalizeProduct(row as never));
  const order = new Map(
    args.productIds.map((id, index) => [id, index] as const)
  );
  mapped.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return mapped;
}

export async function getStorefrontSearchProducts(args: {
  filters?: StorefrontSearchFilters;
  merchantId: string;
  query: string;
  limit: number;
  offset?: number;
  sort?: StorefrontSearchSort;
  /**
   * Opt into recording this call as a new submission in `search_analytics`.
   * Reads are silent by default; when opted in, recording happens only
   * after the search fully succeeds (ranked call plus hydration): partial
   * failures stay untracked so a retry records the submission exactly
   * once.
   */
  trackAnalytics?: boolean;
}): Promise<StorefrontSearchProductsPage> {
  const publicSupabase = createPublicClient({
    clientInfo: 'baci-storefront-search-page',
  });
  const serverSupabase = createClient(await cookies());
  const requestedLimit = clampSearchLimit(args.limit);
  const requestedOffset = normalizeSearchOffset(args.offset);
  const conditionFilter = args.filters?.condition ?? null;
  const needsConditionFamilyFilter = Boolean(
    conditionFilter && !storefrontProductFilters.isAllFilter(conditionFilter)
  );

  // Analytics records only fully successful searches. The ranked calls below
  // run untracked; scheduling happens at each return instead. `after()` runs
  // even for error-panel renders, so scheduling before the fallible
  // did-you-mean/hydration steps would record partial failures — and a retry
  // would then recount the same submission. Counts reflect the returned
  // page (post-filter matches on the family path: what the shopper sees).
  // Reads are silent by default: only explicit submissions (via the
  // submissions endpoint) write analytics. Callers opt into render
  // tracking explicitly where a first-page view counts as a submission.
  const shouldTrackSearch = args.trackAnalytics ?? false;
  const trackSearchSubmission = (result: { count: number; query: string }) => {
    if (shouldTrackSearch) {
      scheduleSearchAnalyticsInsert({
        merchantId: args.merchantId,
        query: result.query,
        resultsCount: result.count,
      });
    }
  };

  // Fast path: no in-memory family filter, so search_products_v2 owns
  // pagination and returns the exact total count in one page.
  if (!needsConditionFamilyFilter) {
    const searchResult = await searchStorefrontProducts({
      supabase: serverSupabase,
      filters: args.filters,
      merchantId: args.merchantId,
      query: args.query,
      limit: requestedLimit,
      offset: requestedOffset,
      sort: args.sort,
      trackAnalytics: false,
    });

    if (searchResult.productIds.length === 0) {
      trackSearchSubmission(searchResult);
      return { ...searchResult, products: [] };
    }

    const products = await hydrateRankedStorefrontProducts({
      supabase: publicSupabase,
      merchantId: args.merchantId,
      productIds: searchResult.productIds,
    });

    const result = { ...searchResult, products };
    trackSearchSubmission(result);
    return result;
  }

  // Family-filter path: condition families are matched in memory, so accumulate
  // ranked candidates across pages to keep the count and pagination accurate.
  const candidates = await collectRankedSearchProductIds({
    supabase: serverSupabase,
    merchantId: args.merchantId,
    query: args.query,
    filters: { ...args.filters, condition: null },
    sort: args.sort,
    trackAnalytics: false,
  });

  if (candidates.productIds.length === 0) {
    const result = {
      count: 0,
      didYouMean: candidates.didYouMean,
      productIds: [],
      products: [],
      query: candidates.query,
    };
    trackSearchSubmission(result);
    return result;
  }

  const hydrated = await hydrateRankedStorefrontProducts({
    supabase: publicSupabase,
    merchantId: args.merchantId,
    productIds: candidates.productIds,
  });

  const filteredProducts = hydrated.filter((product) =>
    storefrontProductFilters.matchesStorefrontConditionFilter(
      product,
      conditionFilter ?? ''
    )
  );
  const products = filteredProducts.slice(
    requestedOffset,
    requestedOffset + requestedLimit
  );

  const result = {
    count: filteredProducts.length,
    didYouMean: candidates.didYouMean,
    productIds: products.map((product) => product.id),
    products,
    query: candidates.query,
  };
  trackSearchSubmission(result);
  return result;
}
