import {
  buildProductSearchQuery,
  extractProductSearchIds,
  orderRecordsByIds,
} from '@baci/shared';
import { getRefinedSearchArgs } from '@baci/shared/lib';
import { withSupabaseRetry } from '@/lib/api';
import { createLogger } from '@/lib/logger';
import { normalizeProductConditionFilterValue } from '@/lib/product-filter-options';
import { supabase } from '@/lib/supabase';
import type { UseProductsOptions } from './product-utils.types';

const log = createLogger('Products');

export async function fetchAvailableBrands(
  merchantId: string,
  options: UseProductsOptions
): Promise<string[]> {
  if (options.refinements && options.search) {
    const {
      brands_filter: _brands,
      sort_by: _sort,
      result_limit: _limit,
      result_offset: _offset,
      ...args
    } = getRefinedSearchArgs(
      merchantId,
      buildProductSearchQuery(options.search).normalized,
      options.refinements,
      20
    );
    const { data, error } = await withSupabaseRetry(
      async () => await supabase.rpc('get_storefront_search_brands', args)
    );
    if (error) throw new Error('Filter options unavailable');
    return (data ?? []).flatMap((row: { brand?: unknown }) =>
      typeof row.brand === 'string' && row.brand.trim() ? [row.brand] : []
    );
  }
  const brands = new Set<string>();
  const pageSize = options.search ? 100 : 500;
  let offset = 0;

  // Mirror fetchProductsPage: an explicitly provided search that
  // normalizes to nothing matches no brands rather than all of them.
  if (options.search && !buildProductSearchQuery(options.search).normalized) {
    return [];
  }

  while (true) {
    const normalizedSearch = options.search
      ? buildProductSearchQuery(options.search).normalized
      : '';
    const normalizedCondition = normalizeProductConditionFilterValue(
      options.condition
    );

    if (normalizedSearch) {
      const { data: rankedResults, error: rankedError } =
        await withSupabaseRetry(
          async () =>
            await supabase.rpc('search_products_v2', {
              brand_filter: null,
              category_id_filter: options.category ?? null,
              condition_filter: normalizedCondition ?? null,
              max_price_filter: options.maxPrice ?? null,
              merchant_id_param: merchantId,
              min_price_filter: options.minPrice ?? null,
              min_rating_filter: options.minRating ?? null,
              parent_only: false,
              result_limit: pageSize,
              result_offset: offset,
              search_query: normalizedSearch,
              sort_by: 'relevance',
              status_filter: 'active',
              stock_filter: null,
            }),
          {
            maxRetries: 3,
            onRetry: (attempt, err) => {
              log.warn(`Brand search retry ${attempt}: ${err.message}`);
            },
          }
        );
      if (rankedError) throw rankedError;

      const productIds = extractProductSearchIds(rankedResults ?? []);
      if (productIds.length === 0) break;

      const { data, error } = await withSupabaseRetry(
        async () =>
          await supabase
            .from('products')
            .select('id, brand')
            .eq('merchant_id', merchantId)
            .in('id', productIds),
        {
          maxRetries: 3,
          onRetry: (attempt, err) => {
            log.warn(`Brand rows retry ${attempt}: ${err.message}`);
          },
        }
      );
      if (error) throw error;

      for (const row of orderRecordsByIds(
        (data ?? []) as { id: string; brand?: string | null }[],
        productIds
      )) {
        const brand = row?.brand;
        if (brand?.trim()) brands.add(brand);
      }
      if (productIds.length < pageSize) break;
      offset += pageSize;
      continue;
    }

    let query = supabase
      .from('products')
      .select('brand')
      .eq('merchant_id', merchantId)
      .eq('status', 'active');

    if (options.category) query = query.eq('category_id', options.category);
    if (normalizedCondition) {
      query = query.or(
        `condition.eq.${normalizedCondition},available_conditions.cs.{${normalizedCondition}}`
      );
    }
    if (options.minPrice !== undefined)
      query = query.gte('price', options.minPrice);
    if (options.maxPrice !== undefined)
      query = query.lte('price', options.maxPrice);
    if (options.minRating !== undefined && options.minRating > 0) {
      query = query.gte('average_rating', options.minRating);
    }

    query = query
      .order('brand', { ascending: true })
      .range(offset, offset + pageSize - 1);
    const result = await withSupabaseRetry(async () => await query, {
      maxRetries: 3,
      onRetry: (attempt, err) => {
        log.warn(`Brand retry ${attempt}: ${err.message}`);
      },
    });
    if (result.error) throw result.error;

    const rows = result.data ?? [];
    for (const row of rows) {
      const brand = row?.brand;
      if (brand?.trim()) brands.add(brand);
    }
    if (rows.length < pageSize) break;
    offset += pageSize;
  }

  return Array.from(brands).sort((left, right) => left.localeCompare(right));
}
