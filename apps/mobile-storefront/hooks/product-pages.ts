import {
  buildProductSearchQuery,
  extractProductSearchIds,
  getProductSearchTotalCount,
  orderRecordsByIds,
} from '@baci/shared';
import { hydrateRowsNeedingStorefrontVariants } from '@/hooks/product-hydration';
import { withSupabaseRetry } from '@/lib/api';
import { createLogger } from '@/lib/logger';
import { normalizeProductConditionFilterValue } from '@/lib/product-filter-options';
import { supabase } from '@/lib/supabase';
import type { Product } from '@/types/product';
import { PRODUCT_SELECT } from './product-select';
import { transformProduct } from './product-transform';
import type { ProductsPage, UseProductsOptions } from './product-utils.types';
import { fetchRefinedProductsPage } from './refined-product-pages';

const log = createLogger('Products');

export async function fetchProductsPage(
  merchantId: string,
  options: UseProductsOptions,
  offset: number
): Promise<ProductsPage> {
  const limit = options.limit || 20;
  const normalizedSearch = options.search
    ? buildProductSearchQuery(options.search).normalized
    : '';
  const normalizedCondition = normalizeProductConditionFilterValue(
    options.condition
  );

  // An explicitly provided search that normalizes to nothing (e.g. "!!")
  // matches nothing: fall through to the unfiltered branch would present
  // the entire catalog as matches for the query.
  if (options.search && !normalizedSearch) {
    return { nextOffset: null, products: [], total: 0 };
  }

  if (normalizedSearch && options.refinements) {
    return fetchRefinedProductsPage(
      merchantId,
      normalizedSearch,
      options.refinements,
      limit,
      offset
    );
  }

  if (normalizedSearch) {
    const { data: rankedResults, error: rankedError } = await withSupabaseRetry(
      async () =>
        await supabase.rpc('search_products_v2', {
          brand_filter: options.brand ?? null,
          category_id_filter: options.category ?? null,
          condition_filter: normalizedCondition ?? null,
          max_price_filter: options.maxPrice ?? null,
          merchant_id_param: merchantId,
          min_price_filter: options.minPrice ?? null,
          min_rating_filter: options.minRating ?? null,
          parent_only: false,
          result_limit: limit,
          result_offset: offset,
          search_query: normalizedSearch,
          sort_by: options.sortBy ?? 'relevance',
          status_filter: 'active',
          stock_filter: null,
        }),
      {
        maxRetries: 3,
        onRetry: (attempt, err) => {
          log.warn(`Search retry ${attempt}: ${err.message}`);
        },
      }
    );
    if (rankedError) throw rankedError;

    const productIds = extractProductSearchIds(rankedResults ?? []);
    const total = getProductSearchTotalCount(rankedResults ?? []);
    if (productIds.length === 0) {
      return { nextOffset: null, products: [], total };
    }

    const { data, error } = await withSupabaseRetry(
      async () =>
        await supabase
          .from('products')
          .select(PRODUCT_SELECT)
          .eq('merchant_id', merchantId)
          .eq('status', 'active')
          .in('id', productIds),
      {
        maxRetries: 3,
        onRetry: (attempt, err) => {
          log.warn(`Search rows retry ${attempt}: ${err.message}`);
        },
      }
    );
    if (error) throw error;

    const hydratedRows = await hydrateRowsNeedingStorefrontVariants(
      (data ?? []) as Record<string, unknown>[]
    );
    const products = orderRecordsByIds(
      hydratedRows as { id: string }[],
      productIds
    )
      .map(transformProduct)
      .filter((product): product is Product => product !== null);
    return {
      products,
      nextOffset: offset + limit < total ? offset + limit : null,
      total,
    };
  }

  let query = supabase
    .from('products')
    .select(PRODUCT_SELECT, { count: 'exact' })
    .eq('merchant_id', merchantId)
    .eq('status', 'active');

  if (options.category) query = query.eq('category_id', options.category);
  if (normalizedCondition) {
    query = query.or(
      `condition.eq.${normalizedCondition},available_conditions.cs.{${normalizedCondition}}`
    );
  }
  if (options.brand) query = query.eq('brand', options.brand);
  if (options.minPrice !== undefined)
    query = query.gte('price', options.minPrice);
  if (options.maxPrice !== undefined)
    query = query.lte('price', options.maxPrice);
  if (options.minRating !== undefined && options.minRating > 0) {
    query = query.gte('average_rating', options.minRating);
  }

  switch (options.sortBy) {
    case 'price_asc':
      query = query.order('price', { ascending: true });
      break;
    case 'price_desc':
      query = query.order('price', { ascending: false });
      break;
    case 'popular':
      query = query.order('view_count', { ascending: false });
      break;
    default:
      query = query.order('created_at', { ascending: false });
  }

  query = query.range(offset, offset + limit - 1);
  const result = await withSupabaseRetry(async () => await query, {
    maxRetries: 3,
    onRetry: (attempt, err) => {
      log.warn(`Retry ${attempt}: ${err.message}`);
    },
  });
  if (result.error) throw result.error;

  const hydratedRows = await hydrateRowsNeedingStorefrontVariants(
    (result.data || []) as Record<string, unknown>[]
  );
  const products = hydratedRows
    .map(transformProduct)
    .filter((product): product is Product => product !== null);
  const resultWithCount = result as typeof result & { count: number | null };
  const total = resultWithCount.count ?? 0;

  return {
    products,
    nextOffset: offset + limit < total ? offset + limit : null,
    total,
  };
}
