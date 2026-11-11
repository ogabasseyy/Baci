import { cookies } from 'next/headers';
import { projectAdvertisedPhonePrices } from './advertised-phone-price-projection';
import { getPublicProductVariantsByProductIds } from './cached-data';
import { type NormalizedProduct, normalizeProduct } from './normalize-product';
import { projectStandardListingRows } from './project-standard-listing-rows';
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
import { createPublicClient } from './supabase/public';
import { createClient } from './supabase/server';

export interface StorefrontSearchProductsPage extends StorefrontSearchResult {
  products: NormalizedProduct[];
}

async function hydrateRankedStorefrontProducts(args: {
  supabase: ReturnType<typeof createPublicClient>;
  merchantId: string;
  productIds: string[];
  projectAdvertisedPrices?: boolean;
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

  const rawRows =
    args.projectAdvertisedPrices === false
      ? (data ?? [])
      : await projectStandardListingRows(args.merchantId, data ?? []);
  const mapped = rawRows.map((row) => normalizeProduct(row as never));
  const order = new Map(
    args.productIds.map((id, index) => [id, index] as const)
  );
  mapped.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return mapped;
}

export async function getStorefrontSearchProducts(args: {
  filters?: StorefrontSearchFilters;
  refinements?: import('@baci/shared/lib').SearchRefinements;
  merchantId: string;
  query: string;
  limit: number;
  offset?: number;
  sort?: StorefrontSearchSort;
}): Promise<StorefrontSearchProductsPage> {
  if (args.refinements) {
    const { getStorefrontRefinedSearchProducts } = await import(
      './storefront-search-refined-products'
    );
    return getStorefrontRefinedSearchProducts({
      ...args,
      refinements: args.refinements,
    });
  }
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
    });

    if (searchResult.productIds.length === 0) {
      return { ...searchResult, products: [] };
    }

    const products = await hydrateRankedStorefrontProducts({
      supabase: publicSupabase,
      merchantId: args.merchantId,
      productIds: searchResult.productIds,
    });

    const result = { ...searchResult, products };
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
  });

  if (candidates.productIds.length === 0) {
    const result = {
      count: 0,
      didYouMean: candidates.didYouMean,
      productIds: [],
      products: [],
      query: candidates.query,
    };
    return result;
  }

  const hydrated = await hydrateRankedStorefrontProducts({
    supabase: publicSupabase,
    merchantId: args.merchantId,
    productIds: candidates.productIds,
    projectAdvertisedPrices: false,
  });

  const filteredProducts = hydrated.filter((product) =>
    storefrontProductFilters.matchesStorefrontConditionFilter(
      product,
      conditionFilter ?? ''
    )
  );
  const selectedWindow = filteredProducts.slice(
    requestedOffset,
    requestedOffset + requestedLimit
  );
  const projectedWindow = await projectAdvertisedPhonePrices(
    args.merchantId,
    selectedWindow,
    getPublicProductVariantsByProductIds,
    { condition: conditionFilter ?? undefined }
  );
  const products = projectedWindow.map((product) => ({
    ...product,
    price: product.advertised_price ?? product.price,
    condition: product.advertised_condition ?? product.condition,
    compare_at_price:
      product.advertised_price !== undefined
        ? (product.advertised_compare_at_price ?? null)
        : product.compare_at_price,
    ...(product.advertised_image
      ? {
          image: product.advertised_image,
          imageLarge: product.advertised_image,
          images: [product.advertised_image],
        }
      : {}),
  }));

  const result = {
    count: filteredProducts.length,
    didYouMean: candidates.didYouMean,
    productIds: products.map((product) => product.id),
    products,
    query: candidates.query,
  };
  return result;
}
