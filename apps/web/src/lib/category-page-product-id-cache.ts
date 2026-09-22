import { cacheLife, cacheTag } from 'next/cache';
import { getCategoryPageDataCacheTag } from '@/lib/category-page-cache-tags';
import {
  applyCategoryGraphicsPredicate,
  buildCategoryGraphicsJoin,
  normalizeCategoryGraphicsValues,
} from '@/lib/category-page-graphics-query';
import { getPublicSupabaseClient } from '@/lib/public-supabase-client';

export type SpecialCollectionSlug =
  | 'new-arrivals'
  | 'best-sellers'
  | 'on-sale'
  | 'featured';

export type CachedCategoryPageProductScope =
  | { categoryId: string; categoryIds: string[]; kind: 'category' }
  | { collectionSlug: SpecialCollectionSlug; kind: 'collection' }
  | { categoryName: string; kind: 'legacy' }
  | { kind: 'none' };

export const CATEGORY_PAGE_PRODUCT_ID_CAP = 2000;

export interface CategoryPageProductFilters {
  graphics?: string[];
}

type ActiveCategoryPageProductScope = Exclude<
  CachedCategoryPageProductScope,
  { kind: 'none' }
>;

type RemotelyCachedCategoryPageProductScope = Exclude<
  CachedCategoryPageProductScope,
  { kind: 'legacy' }
>;

export {
  MAX_CATEGORY_GRAPHICS_VALUE_LENGTH,
  normalizeCategoryGraphicsValue,
} from './category-page-graphics-query';

function buildCategoryPageProductIdsQuery(
  supabase: ReturnType<typeof getPublicSupabaseClient>,
  merchantId: string,
  scope: ActiveCategoryPageProductScope,
  selectOptions?: { count: 'exact'; head: boolean },
  filters?: CategoryPageProductFilters
) {
  const graphics = normalizeCategoryGraphicsValues(filters?.graphics);
  const graphicsJoin = buildCategoryGraphicsJoin(graphics);

  if (scope.kind === 'category') {
    const query = applyCategoryGraphicsPredicate(
      supabase
        .from('products')
        .select(
          `id, product_categories!inner(category_id)${graphicsJoin}`,
          selectOptions
        )
        .eq('merchant_id', merchantId)
        .eq('status', 'active')
        .in('product_categories.category_id', scope.categoryIds)
        .order('created_at', { ascending: false })
        .order('id', { ascending: true }),
      graphics
    );

    return query;
  }

  if (scope.kind === 'legacy') {
    const sanitizedCategoryName = scope.categoryName.replace(/[,().]/g, '');
    const query = applyCategoryGraphicsPredicate(
      supabase
        .from('products')
        .select(`id${graphicsJoin}`, selectOptions)
        .eq('merchant_id', merchantId)
        .eq('status', 'active')
        .or(
          `category.ilike.%${sanitizedCategoryName}%,brand.ilike.%${sanitizedCategoryName}%,name.ilike.%${sanitizedCategoryName}%`
        )
        .order('created_at', { ascending: false })
        .order('id', { ascending: true }),
      graphics
    );

    return query;
  }

  let query = applyCategoryGraphicsPredicate(
    supabase
      .from('products')
      .select(`id${graphicsJoin}`, selectOptions)
      .eq('merchant_id', merchantId)
      .eq('status', 'active'),
    graphics
  );

  switch (scope.collectionSlug) {
    case 'new-arrivals':
      query = query
        .order('created_at', { ascending: false })
        .order('id', { ascending: true });
      break;
    case 'best-sellers':
      query = query
        .order('rating', { ascending: false })
        .order('id', { ascending: true });
      break;
    case 'on-sale':
      query = query
        .not('compare_at_price', 'is', null)
        .order('updated_at', { ascending: false })
        .order('id', { ascending: true });
      break;
    case 'featured':
      query = query
        .order('price', { ascending: false })
        .order('id', { ascending: true });
      break;
  }

  return query;
}

function extractCategoryPageProductIds(data: unknown): string[] {
  return ((data || []) as Array<{ id?: string | null }>)
    .map((product) => product.id)
    .filter((id): id is string => Boolean(id));
}

/**
 * Remote canonical IDs/counts use merchant-scoped category tags so product or
 * category mutations propagate without evicting other merchants' entries.
 */
async function getCachedCategoryPageProductIds({
  filters,
  merchantId,
  scope,
}: {
  filters?: CategoryPageProductFilters;
  merchantId: string;
  scope: RemotelyCachedCategoryPageProductScope;
}): Promise<string[]> {
  'use cache: remote';
  cacheLife('storefront-page');
  cacheTag(
    getCategoryPageDataCacheTag(merchantId),
    'products',
    'categories',
    `products-${merchantId}`,
    `categories-${merchantId}`
  );

  if (scope.kind === 'none') return [];

  const { data, error } = await buildCategoryPageProductIdsQuery(
    getPublicSupabaseClient(),
    merchantId,
    scope,
    undefined,
    filters
  ).limit(CATEGORY_PAGE_PRODUCT_ID_CAP);
  if (error) throw error;
  return extractCategoryPageProductIds(data);
}

async function getCachedLegacyCategoryPageProductIds({
  filters,
  merchantId,
  scope,
}: {
  filters?: CategoryPageProductFilters;
  merchantId: string;
  scope: Extract<CachedCategoryPageProductScope, { kind: 'legacy' }>;
}): Promise<string[]> {
  'use cache';
  cacheLife('storefront-page');
  cacheTag(
    getCategoryPageDataCacheTag(merchantId),
    'products',
    'categories',
    `products-${merchantId}`,
    `categories-${merchantId}`
  );

  const { data, error } = await buildCategoryPageProductIdsQuery(
    getPublicSupabaseClient(),
    merchantId,
    scope,
    undefined,
    filters
  ).limit(CATEGORY_PAGE_PRODUCT_ID_CAP);
  if (error) throw error;
  return extractCategoryPageProductIds(data);
}

async function getCachedCategoryPageProductTotalCount({
  filters,
  merchantId,
  scope,
}: {
  filters?: CategoryPageProductFilters;
  merchantId: string;
  scope: RemotelyCachedCategoryPageProductScope;
}): Promise<number> {
  'use cache: remote';
  cacheLife('storefront-page');
  cacheTag(
    getCategoryPageDataCacheTag(merchantId),
    'products',
    'categories',
    `products-${merchantId}`,
    `categories-${merchantId}`
  );

  if (scope.kind === 'none') return 0;

  const { count, error } = await buildCategoryPageProductIdsQuery(
    getPublicSupabaseClient(),
    merchantId,
    scope,
    { count: 'exact', head: true },
    filters
  );
  if (error) throw error;
  return count ?? 0;
}

async function getCachedLegacyCategoryPageProductTotalCount({
  filters,
  merchantId,
  scope,
}: {
  filters?: CategoryPageProductFilters;
  merchantId: string;
  scope: Extract<CachedCategoryPageProductScope, { kind: 'legacy' }>;
}): Promise<number> {
  'use cache';
  cacheLife('storefront-page');
  cacheTag(
    getCategoryPageDataCacheTag(merchantId),
    'products',
    'categories',
    `products-${merchantId}`,
    `categories-${merchantId}`
  );

  const { count, error } = await buildCategoryPageProductIdsQuery(
    getPublicSupabaseClient(),
    merchantId,
    scope,
    { count: 'exact', head: true },
    filters
  );
  if (error) throw error;
  return count ?? 0;
}

async function fetchCategoryPageProductIdWindow({
  filters,
  from,
  merchantId,
  scope,
  to,
}: {
  filters?: CategoryPageProductFilters;
  from: number;
  merchantId: string;
  scope: CachedCategoryPageProductScope;
  to: number;
}): Promise<string[]> {
  if (scope.kind === 'none') return [];

  const { data, error } = await buildCategoryPageProductIdsQuery(
    getPublicSupabaseClient(),
    merchantId,
    scope,
    undefined,
    filters
  ).range(from, to);
  if (error) throw error;
  return extractCategoryPageProductIds(data);
}

export const categoryPageProductIdCache = {
  fetchProductIdWindow: fetchCategoryPageProductIdWindow,
  getLegacyProductIds: getCachedLegacyCategoryPageProductIds,
  getLegacyProductTotalCount: getCachedLegacyCategoryPageProductTotalCount,
  getProductIds: getCachedCategoryPageProductIds,
  getProductTotalCount: getCachedCategoryPageProductTotalCount,
};
