import {
  extractProductSearchIds,
  getProductSearchTotalCount,
} from '@baci/shared';
import { cookies } from 'next/headers';
import { after } from 'next/server';
import { logger } from './logger';
import { type NormalizedProduct, normalizeProduct } from './normalize-product';
import { isValidUuid, sanitizeSearchQuery } from './sanitize-core';
import { storefrontProductFilters } from './storefront-product-filters';
import { STOREFRONT_PRODUCTS_COMPACT_SELECT } from './storefront-products-select';
import { findStorefrontSearchDidYouMean } from './storefront-search-did-you-mean';
import { createPublicClient } from './supabase/public';
import { createClient } from './supabase/server';

export class InvalidMerchantIdError extends Error {
  constructor() {
    super('Invalid merchant_id format');
    this.name = 'InvalidMerchantIdError';
  }
}

export interface StorefrontSearchSupabase {
  rpc: (
    fn: string,
    args: Record<string, unknown>
  ) => PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }>;
}

interface StorefrontSearchAnalyticsSupabase {
  from: (table: string) => {
    insert: (value: Record<string, unknown>) => PromiseLike<{ error: unknown }>;
  };
}

export type StorefrontSearchSort =
  | 'relevance'
  | 'price_asc'
  | 'price_desc'
  | 'popular'
  | 'newest';

export type StorefrontSearchStockFilter =
  | 'in_stock'
  | 'low_stock'
  | 'out_of_stock';

export interface StorefrontSearchFilters {
  brand?: string | null;
  categoryId?: string | null;
  condition?: string | null;
  maxPrice?: number | null;
  minPrice?: number | null;
  minRating?: number | null;
  stock?: StorefrontSearchStockFilter | null;
}

interface SearchStorefrontProductsArgs {
  supabase: StorefrontSearchSupabase;
  analyticsSupabase?: StorefrontSearchAnalyticsSupabase;
  filters?: StorefrontSearchFilters;
  includeDidYouMean?: boolean;
  merchantId: string;
  query: string;
  limit: number;
  offset?: number;
  sort?: StorefrontSearchSort;
  trackAnalytics?: boolean;
}

export interface StorefrontSearchResult {
  count: number;
  didYouMean: string | null;
  productIds: string[];
  query: string;
}

export interface StorefrontSearchProductsPage extends StorefrontSearchResult {
  products: NormalizedProduct[];
}

const MAX_SEARCH_LIMIT = 100;
// search_products_v2 clamps result_limit to 100 and only matches conditions
// exactly. When a storefront "family" filter must be applied in memory, page
// through the full ranked result set before post-filtering so filtered products
// beyond the first RPC page are not silently omitted.
const RANKED_FILTER_PAGE_SIZE = MAX_SEARCH_LIMIT;

function isAfterOutsideRequestScopeError(error: unknown) {
  return (
    error instanceof Error && error.message.includes('outside a request scope')
  );
}

function createSearchAnalyticsClient() {
  return createPublicClient({
    clientInfo: 'baci-storefront-search-analytics',
  });
}

function clampSearchLimit(limit: number) {
  return Math.min(Math.max(Math.trunc(limit || 20), 1), MAX_SEARCH_LIMIT);
}

function normalizeSearchOffset(offset?: number) {
  return Math.max(Math.trunc(offset || 0), 0);
}

export function toStorefrontSearchSort(
  sort?: string | null
): StorefrontSearchSort {
  const sortMap: Record<string, StorefrontSearchSort> = {
    newest: 'newest',
    popular: 'popular',
    'price-asc': 'price_asc',
    'price-desc': 'price_desc',
    price_asc: 'price_asc',
    price_desc: 'price_desc',
    relevance: 'relevance',
  };

  return sort ? (sortMap[sort] ?? 'relevance') : 'relevance';
}

function runSearchAnalyticsAfterResponse(callback: () => Promise<void>) {
  try {
    after(callback);
  } catch (error) {
    if (!isAfterOutsideRequestScopeError(error)) {
      throw error;
    }

    // `after()` is available only inside a Next request/render lifecycle. Keep
    // analytics non-blocking for plain unit tests and non-request callers.
    void callback();
  }
}

async function insertSearchAnalytics({
  supabase,
  merchantId,
  query,
  resultsCount,
}: {
  supabase: StorefrontSearchAnalyticsSupabase;
  merchantId: string;
  query: string;
  resultsCount: number;
}) {
  try {
    const { error: analyticsError } = await supabase
      .from('search_analytics')
      .insert({
        merchant_id: merchantId,
        search_query: query,
        results_count: resultsCount,
        search_method: 'server',
      });

    if (analyticsError) {
      logger.warn({
        message: 'Storefront search analytics insert failed',
        error: analyticsError,
        merchantId,
        query,
      });
    }
  } catch (analyticsError) {
    logger.warn({
      message: 'Storefront search analytics insert failed',
      error: analyticsError,
      merchantId,
      query,
    });
  }
}

function scheduleSearchAnalyticsInsert(args: {
  supabase?: StorefrontSearchAnalyticsSupabase;
  merchantId: string;
  query: string;
  resultsCount: number;
}) {
  const supabase = args.supabase ?? createSearchAnalyticsClient();

  runSearchAnalyticsAfterResponse(() =>
    insertSearchAnalytics({
      ...args,
      supabase,
    })
  );
}

export async function searchStorefrontProducts({
  supabase,
  analyticsSupabase,
  filters,
  includeDidYouMean = true,
  merchantId,
  query,
  limit,
  offset,
  sort = 'relevance',
  trackAnalytics = true,
}: SearchStorefrontProductsArgs): Promise<StorefrontSearchResult> {
  if (!isValidUuid(merchantId)) {
    throw new InvalidMerchantIdError();
  }

  const sanitizedQuery = sanitizeSearchQuery(query);
  const safeLimit = clampSearchLimit(limit);
  const safeOffset = normalizeSearchOffset(offset);

  const { data: rankedResultsRaw, error } = await supabase.rpc(
    'search_products_v2',
    {
      brand_filter: filters?.brand ?? null,
      category_id_filter: filters?.categoryId ?? null,
      condition_filter: filters?.condition ?? null,
      max_price_filter: filters?.maxPrice ?? null,
      merchant_id_param: merchantId,
      min_price_filter: filters?.minPrice ?? null,
      min_rating_filter: filters?.minRating ?? null,
      parent_only: false,
      result_limit: safeLimit,
      result_offset: safeOffset,
      search_query: sanitizedQuery,
      sort_by: sort,
      status_filter: 'active',
      stock_filter: filters?.stock ?? null,
    }
  );

  if (error) {
    throw error;
  }

  const rankedResults = Array.isArray(rankedResultsRaw) ? rankedResultsRaw : [];
  const productIds = extractProductSearchIds(rankedResults);
  const count = getProductSearchTotalCount(rankedResults);

  if (trackAnalytics) {
    scheduleSearchAnalyticsInsert({
      supabase: analyticsSupabase,
      merchantId,
      query: sanitizedQuery,
      resultsCount: count,
    });
  }

  const didYouMean =
    includeDidYouMean && productIds.length === 0
      ? await findStorefrontSearchDidYouMean({
          supabase,
          merchantId,
          query: sanitizedQuery,
        })
      : null;

  return {
    count,
    didYouMean,
    productIds,
    query: sanitizedQuery,
  };
}

export interface RankedSearchCandidates {
  productIds: string[];
  query: string;
  didYouMean: string | null;
  /** True only when an explicit maxCandidates cap stopped collection early. */
  truncated: boolean;
}

/**
 * Pages through `search_products_v2` and accumulates ranked product IDs. Used
 * when storefront family filters must be applied in memory: the RPC caps each
 * page at 100 rows, so a single page would silently drop matches ranked past row
 * 100. Analytics is recorded once (first page) per search. Callers may pass
 * maxCandidates for explicit best-effort prefetches; omit it when post-filtered
 * counts must be exact.
 */
export async function collectRankedSearchProductIds(args: {
  supabase: StorefrontSearchSupabase;
  analyticsSupabase?: StorefrontSearchAnalyticsSupabase;
  merchantId: string;
  query: string;
  filters?: StorefrontSearchFilters;
  sort?: StorefrontSearchSort;
  maxCandidates?: number;
  trackAnalytics?: boolean;
}): Promise<RankedSearchCandidates> {
  const productIds: string[] = [];
  let query = '';
  let didYouMean: string | null = null;
  let total = Number.POSITIVE_INFINITY;
  let pageOffset = 0;

  const candidateLimit = args.maxCandidates;

  while (
    (candidateLimit === undefined || productIds.length < candidateLimit) &&
    pageOffset < total
  ) {
    const page = await searchStorefrontProducts({
      supabase: args.supabase,
      analyticsSupabase: args.analyticsSupabase,
      merchantId: args.merchantId,
      query: args.query,
      filters: args.filters,
      sort: args.sort,
      limit: RANKED_FILTER_PAGE_SIZE,
      offset: pageOffset,
      trackAnalytics: pageOffset === 0 && (args.trackAnalytics ?? true),
    });

    total = page.count;
    if (pageOffset === 0) {
      query = page.query;
      didYouMean = page.didYouMean;
    }

    if (page.productIds.length === 0) {
      break;
    }

    productIds.push(...page.productIds);
    pageOffset += RANKED_FILTER_PAGE_SIZE;
  }

  const cappedProductIds =
    candidateLimit === undefined
      ? productIds
      : productIds.slice(0, candidateLimit);

  return {
    productIds: cappedProductIds,
    query,
    didYouMean,
    truncated:
      candidateLimit !== undefined &&
      Number.isFinite(total) &&
      total > candidateLimit,
  };
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
   * Record this call as a new submission in `search_analytics`. Page views
   * past the first page and internal recovery queries pass `false` so
   * refinement navigation never inflates submission counts.
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
      trackAnalytics: args.trackAnalytics,
    });

    if (searchResult.productIds.length === 0) {
      return { ...searchResult, products: [] };
    }

    const products = await hydrateRankedStorefrontProducts({
      supabase: publicSupabase,
      merchantId: args.merchantId,
      productIds: searchResult.productIds,
    });

    return { ...searchResult, products };
  }

  // Family-filter path: condition families are matched in memory, so accumulate
  // ranked candidates across pages to keep the count and pagination accurate.
  const candidates = await collectRankedSearchProductIds({
    supabase: serverSupabase,
    merchantId: args.merchantId,
    query: args.query,
    filters: { ...args.filters, condition: null },
    sort: args.sort,
    trackAnalytics: args.trackAnalytics,
  });

  if (candidates.productIds.length === 0) {
    return {
      count: 0,
      didYouMean: candidates.didYouMean,
      productIds: [],
      products: [],
      query: candidates.query,
    };
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

  return {
    count: filteredProducts.length,
    didYouMean: candidates.didYouMean,
    productIds: products.map((product) => product.id),
    products,
    query: candidates.query,
  };
}
