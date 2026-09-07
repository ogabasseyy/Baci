import type { SupabaseClient } from '@supabase/supabase-js';
import { cacheLife, cacheTag } from 'next/cache';
import type { CachedCategoryPageProductScope } from '@/lib/category-page-product-id-cache';
import { createStorefrontReadDeadline } from '@/lib/create-storefront-read-deadline';
import { getCategoryFallbackName } from '@/lib/get-category-fallback-name';
import {
  prepareStorefrontSingleAttemptQuery,
  type StorefrontSingleAttemptQuery,
} from '@/lib/prepare-storefront-single-attempt-query';
import { getPublicSupabaseClient } from '@/lib/public-supabase-client';
import { STOREFRONT_SPECIAL_COLLECTION_SLUGS } from '@/lib/storefront-special-collection-slugs';
import type { StorefrontDatabase } from '@/types/storefront-database';

export interface CompareCategoryShell {
  fallbackName: string;
  isCollection: boolean;
  productScope: CachedCategoryPageProductScope;
}

interface CategoryRow {
  id: string;
  is_active: boolean | null;
  name: string | null;
}

interface CategorySlugState {
  is_active: boolean | null;
}

function isSpecialCollectionSlug(categorySlug: string): boolean {
  return STOREFRONT_SPECIAL_COLLECTION_SLUGS.includes(
    categorySlug as (typeof STOREFRONT_SPECIAL_COLLECTION_SLUGS)[number]
  );
}

function getSpecialCollectionName(categorySlug: string): string {
  switch (categorySlug) {
    case 'new-arrivals':
      return 'New Arrivals';
    case 'best-sellers':
      return 'Best Sellers';
    case 'on-sale':
      return 'On Sale';
    case 'featured':
      return 'Featured';
    default:
      return getCategoryFallbackName(categorySlug);
  }
}

export async function getCachedCompareCategoryShell(
  merchantId: string,
  categorySlug: string
): Promise<CompareCategoryShell> {
  'use cache';
  cacheLife('products');
  cacheTag(
    'category-page-data',
    'products',
    'categories',
    `products-${merchantId}`,
    `categories-${merchantId}`
  );

  if (isSpecialCollectionSlug(categorySlug)) {
    return {
      fallbackName: getSpecialCollectionName(categorySlug),
      isCollection: true,
      productScope: {
        kind: 'collection',
        collectionSlug:
          categorySlug as (typeof STOREFRONT_SPECIAL_COLLECTION_SLUGS)[number],
      },
    };
  }

  const supabase =
    getPublicSupabaseClient() as unknown as SupabaseClient<StorefrontDatabase>;
  const deadline = createStorefrontReadDeadline(3_000);
  const run = <T>(query: StorefrontSingleAttemptQuery<T>): Promise<T> =>
    Promise.race([
      Promise.resolve(
        prepareStorefrontSingleAttemptQuery(query, deadline.signal)
      ),
      deadline.promise,
    ]);
  const categoryQuery = supabase
    .from('categories')
    .select('id, name, is_active')
    .eq('merchant_id', merchantId)
    .eq('slug', categorySlug)
    .single() as unknown as StorefrontSingleAttemptQuery<{
    data: CategoryRow | null;
    error: unknown;
  }>;
  try {
    const { data: categoryRow, error: categoryError } =
      await run(categoryQuery);

    const noRows =
      categoryError &&
      typeof categoryError === 'object' &&
      categoryError !== null &&
      Reflect.get(categoryError, 'code') === 'PGRST116';
    if (categoryError && !noRows) throw categoryError;

    let hiddenCategoryState: CategorySlugState | null = null;
    if (!categoryRow) {
      const rpcQuery = supabase.rpc('get_storefront_category_slug_state', {
        p_merchant_id: merchantId,
        p_slug: categorySlug,
      }) as unknown as StorefrontSingleAttemptQuery<{
        data: CategorySlugState[] | null;
        error: unknown;
      }>;
      const { data, error } = await run(rpcQuery);
      if (error) throw error;
      const states = data as CategorySlugState[] | null;
      hiddenCategoryState = states?.[0] ?? null;
    }

    const isInactiveCategory =
      categoryRow?.is_active === false ||
      hiddenCategoryState?.is_active === false;
    const fallbackName =
      categoryRow?.name || getCategoryFallbackName(categorySlug);

    if (isInactiveCategory) {
      return {
        fallbackName,
        isCollection: false,
        productScope: { kind: 'none' },
      };
    }

    if (!categoryRow?.id) {
      return {
        fallbackName,
        isCollection: false,
        productScope: { kind: 'legacy', categoryName: fallbackName },
      };
    }

    const scopeQuery = supabase
      .from('categories')
      .select('id')
      .eq('merchant_id', merchantId)
      .eq('is_active', true)
      .or(
        `id.eq.${categoryRow.id},parent_id.eq.${categoryRow.id}`
      ) as unknown as StorefrontSingleAttemptQuery<{
      data: Array<{ id?: string | null }> | null;
      error: unknown;
    }>;
    const { data: categoryScope, error: categoryScopeError } =
      await run(scopeQuery);
    if (categoryScopeError) throw categoryScopeError;

    const categoryIds = Array.from(
      new Set(
        [
          categoryRow.id,
          ...((categoryScope || []) as Array<{ id?: string | null }>).map(
            (item) => item.id
          ),
        ].filter((id): id is string => typeof id === 'string' && id.length > 0)
      )
    );

    return {
      fallbackName,
      isCollection: false,
      productScope: {
        kind: 'category',
        categoryId: categoryRow.id,
        categoryIds,
      },
    };
  } finally {
    deadline.cleanup();
  }
}
