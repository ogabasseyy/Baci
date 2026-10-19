import { cacheLife, cacheTag } from 'next/cache';
import type {
  CachedCategoryPageShellData,
  CachedCategoryRecord,
} from '@/lib/cached-category-page-shell-types';
import type {
  CachedCategoryPageProductScope,
  SpecialCollectionSlug,
} from '@/lib/category-page-product-id-cache';
import { getCategoryFallbackName } from '@/lib/get-category-fallback-name';
import { isPostgrestNoRowsError } from '@/lib/is-postgrest-no-rows-error';
import { getPublicSupabaseClient } from '@/lib/public-supabase-client';
import { STOREFRONT_SPECIAL_COLLECTION_SLUGS } from '@/lib/storefront-special-collection-slugs';

export type {
  CachedCategoryFaqItem,
  CachedCategoryPageShellData,
  CachedCategoryRecord,
  CachedCategorySeo,
} from '@/lib/cached-category-page-shell-types';

interface StorefrontCategoryParentRow {
  name: string | null;
  slug: string | null;
}

interface StorefrontCategoryRow {
  description: string | null;
  id: string;
  image_url: string | null;
  is_active: boolean | null;
  name: string | null;
  parent: StorefrontCategoryParentRow | null;
  seo_description: string | null;
  seo_faq: { answer: string; question: string }[] | null;
  seo_features: string[] | null;
  seo_heading: string | null;
  slug: string | null;
}

interface StorefrontCategorySlugState {
  is_active: boolean | null;
}

const SPECIAL_COLLECTIONS = STOREFRONT_SPECIAL_COLLECTION_SLUGS;

function isSpecialCollectionSlug(
  categorySlug: string
): categorySlug is SpecialCollectionSlug {
  return SPECIAL_COLLECTIONS.includes(categorySlug as SpecialCollectionSlug);
}

function getSpecialCollectionCopy(collectionSlug: SpecialCollectionSlug) {
  switch (collectionSlug) {
    case 'new-arrivals':
      return {
        description: 'Check out the latest additions to our store.',
        name: 'New Arrivals',
      };
    case 'best-sellers':
      return {
        description: 'Our most popular products loved by customers.',
        name: 'Best Sellers',
      };
    case 'on-sale':
      return {
        description: 'Great deals and discounts on top products.',
        name: 'On Sale',
      };
    case 'featured':
      return {
        description: 'Hand-picked highlights just for you.',
        name: 'Featured',
      };
  }
}

/**
 * Cached category identity and scope. It intentionally excludes storefront
 * slug aliases so equivalent merchant/category requests share one entry.
 */
export async function getCachedCategoryPageShellData(
  merchantId: string,
  categorySlug: string
): Promise<CachedCategoryPageShellData> {
  'use cache';
  cacheLife('storefront-page');
  cacheTag(
    'category-page-data',
    'products',
    'categories',
    `products-${merchantId}`,
    `categories-${merchantId}`
  );

  if (isSpecialCollectionSlug(categorySlug)) {
    const collection = getSpecialCollectionCopy(categorySlug);
    return {
      isCollection: true,
      name: collection.name,
      description: collection.description,
      fallbackName: collection.name,
      fallbackDescription: collection.description,
      productScope: { kind: 'collection', collectionSlug: categorySlug },
      seo: {
        heading: collection.name,
        description: collection.description,
        features: [],
        faqs: [],
      },
    };
  }

  const supabase = getPublicSupabaseClient();
  const categoryQuery = supabase
    .from('categories')
    .select(
      'id, name, slug, description, image_url, is_active, seo_heading, seo_description, seo_features, seo_faq, parent:parent_id(name, slug)'
    )
    .eq('merchant_id', merchantId)
    .eq('slug', categorySlug)
    .single() as unknown as Promise<{
    data: StorefrontCategoryRow | null;
    error: unknown;
  }>;
  const { data: categoryRow, error: categoryError } = await categoryQuery;
  if (categoryError && !isPostgrestNoRowsError(categoryError)) {
    throw categoryError;
  }

  let hiddenCategoryState: StorefrontCategorySlugState | null = null;
  if (!categoryRow) {
    const { data: categoryStateData, error: categoryStateError } =
      await supabase.rpc('get_storefront_category_slug_state', {
        p_merchant_id: merchantId,
        p_slug: categorySlug,
      });
    if (categoryStateError) throw categoryStateError;
    const stateArray = categoryStateData as
      | StorefrontCategorySlugState[]
      | null;
    hiddenCategoryState = stateArray?.[0] ?? null;
  }

  const isInactiveCategory =
    categoryRow?.is_active === false ||
    hiddenCategoryState?.is_active === false;
  const category: CachedCategoryRecord | null =
    categoryRow && categoryRow.is_active !== false
      ? {
          ...categoryRow,
          name: categoryRow.name || getCategoryFallbackName(categorySlug),
          slug: categoryRow.slug || categorySlug,
          parent:
            categoryRow.parent?.name && categoryRow.parent.slug
              ? { name: categoryRow.parent.name, slug: categoryRow.parent.slug }
              : null,
          is_active: categoryRow.is_active ?? true,
        }
      : null;
  const categoryName =
    categoryRow?.name || getCategoryFallbackName(categorySlug);
  const categoryDescription =
    categoryRow?.description ||
    `Browse our collection of ${categoryName} products.`;
  let productScope: CachedCategoryPageProductScope = isInactiveCategory
    ? { kind: 'none' }
    : { kind: 'legacy', categoryName };

  if (category?.id) {
    const { data: categoryScope, error: categoryScopeError } = await supabase
      .from('categories')
      .select('id')
      .eq('merchant_id', merchantId)
      .eq('is_active', true)
      .or(`id.eq.${category.id},parent_id.eq.${category.id}`);
    if (categoryScopeError) throw categoryScopeError;
    const categoryIds = Array.from(
      new Set(
        [
          category.id,
          ...((categoryScope || []) as Array<{ id?: string | null }>).map(
            (item) => item.id
          ),
        ].filter((id): id is string => typeof id === 'string' && id.length > 0)
      )
    );
    productScope = {
      kind: 'category',
      categoryId: category.id,
      categoryIds,
    };
  }

  return {
    isCollection: false,
    category,
    fallbackName: categoryName,
    fallbackDescription: categoryDescription,
    isInactiveCategory,
    categoryQueryFailed: false,
    productScope,
  };
}
