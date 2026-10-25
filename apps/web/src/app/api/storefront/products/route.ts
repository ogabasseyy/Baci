import { formatSupabaseErrorLog } from '@baci/shared/lib';
import { createClient as createStaticClient } from '@supabase/supabase-js';
import { unstable_cache } from 'next/cache';
import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { getSupabaseAnonKey, getSupabaseUrl } from '@/env';
import { getPrimaryProductImage } from '@/lib/product-image';
import { projectStandardListingRows } from '@/lib/project-standard-listing-rows';
import { storefrontProductFilters } from '@/lib/storefront-product-filters';
import {
  buildStorefrontProductsCacheKeyParts,
  buildStorefrontProductsCacheTags,
} from '@/lib/storefront-products-cache-key';
import {
  collectRankedSearchProductIds,
  searchStorefrontProducts,
  toStorefrontSearchSort,
} from '@/lib/storefront-search';
import { createClient } from '@/lib/supabase/server';
import { storefrontProductsQuerySchema } from '@/schemas/storefront-products-query';
import type { StorefrontProductsQuery } from '@/schemas/storefront-products-query.types';
import {
  type RawStorefrontProductRow,
  storefrontProductsRouteData,
} from './storefront-products-route-data';

type ProductFilters = StorefrontProductsQuery;

const PRODUCT_ID_FETCH_CHUNK_SIZE = 100;
const IN_MEMORY_FILTER_MIN_PAGE_SIZE = 48;
const IN_MEMORY_FILTER_MAX_PAGE_SIZE = 200;
const IN_MEMORY_FILTER_PAGE_SIZE_MULTIPLIER = 4;
const IN_MEMORY_FILTER_DEFAULT_TARGET = 1000;

function hasInMemoryStorefrontFilters(filters: ProductFilters): boolean {
  return Boolean(
    (filters.category &&
      !storefrontProductFilters.isAllFilter(filters.category)) ||
      (filters.brand && !storefrontProductFilters.isAllFilter(filters.brand)) ||
      (filters.condition &&
        !storefrontProductFilters.isAllFilter(filters.condition))
  );
}

function escapeStorefrontSearchPattern(value: string) {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('%', '\\%')
    .replaceAll('_', '\\_');
}

function getInMemoryFilterPageSize(limit: number): number {
  return Math.min(
    IN_MEMORY_FILTER_MAX_PAGE_SIZE,
    Math.max(
      IN_MEMORY_FILTER_MIN_PAGE_SIZE,
      limit * IN_MEMORY_FILTER_PAGE_SIZE_MULTIPLIER
    )
  );
}

function applyInMemoryStorefrontFilters(
  products: RawStorefrontProductRow[],
  filters: ProductFilters
): RawStorefrontProductRow[] {
  let filteredProducts = products;

  if (
    filters.category &&
    !storefrontProductFilters.isAllFilter(filters.category)
  ) {
    const category = filters.category;
    filteredProducts = filteredProducts.filter((product) =>
      storefrontProductFilters.matchesStorefrontCategoryFilter(
        storefrontProductsRouteData.buildCategoryFilterSource(product),
        category
      )
    );
  }

  if (filters.brand && !storefrontProductFilters.isAllFilter(filters.brand)) {
    const brand = filters.brand;
    filteredProducts = filteredProducts.filter((product) =>
      storefrontProductFilters.matchesStorefrontBrandFilter(product, brand)
    );
  }

  if (
    filters.condition &&
    !storefrontProductFilters.isAllFilter(filters.condition)
  ) {
    const condition = filters.condition;
    filteredProducts = filteredProducts.filter((product) =>
      storefrontProductFilters.matchesStorefrontConditionFilter(
        product,
        condition
      )
    );
  }

  return filteredProducts;
}

function createCachedProductsFetcher(
  merchantId: string,
  filters: ProductFilters = { sort: 'newest' }
) {
  const cacheKeyParts = buildStorefrontProductsCacheKeyParts(
    merchantId,
    filters
  );

  return unstable_cache(
    async () => {
      const supabase = createStaticClient(
        getSupabaseUrl(),
        getSupabaseAnonKey()
      );
      const hasInMemoryFilters = hasInMemoryStorefrontFilters(filters);
      const selectColumns: string =
        filters.compact === false
          ? storefrontProductsRouteData.STOREFRONT_PRODUCTS_SELECT
          : storefrontProductsRouteData.STOREFRONT_PRODUCTS_COMPACT_SELECT;

      const fetchProductRows = async (range?: { from: number; to: number }) => {
        let query = supabase
          .from('products')
          .select(selectColumns)
          .eq('merchant_id', merchantId)
          .eq('status', 'active');

        if (
          filters.condition &&
          !storefrontProductFilters.isAllFilter(filters.condition)
        ) {
          const clauses =
            storefrontProductsRouteData.getConditionPrefilterClauses(
              filters.condition
            );
          if (clauses.length > 0) {
            query = query.or(clauses.join(','));
          }
        }

        if (filters.min_price !== undefined) {
          query = query.gte('price', filters.min_price);
        }

        if (filters.max_price !== undefined) {
          query = query.lte('price', filters.max_price);
        }

        if (filters.has_images) {
          query = query.not('images->0', 'is', null);
        }

        if (filters.q) {
          const sanitizedQuery = escapeStorefrontSearchPattern(
            filters.q.slice(0, 100)
          );
          query = query.or(
            `name.ilike.%${sanitizedQuery}%,description.ilike.%${sanitizedQuery}%`
          );
        }

        if (range) {
          query = query.range(range.from, range.to);
        } else if (filters.limit !== undefined && !hasInMemoryFilters) {
          query = query.limit(filters.limit);
        }

        switch (filters.sort) {
          case 'price-asc':
            query = query
              .order('price', { ascending: true })
              .order('id', { ascending: true });
            break;
          case 'price-desc':
            query = query
              .order('price', { ascending: false })
              .order('id', { ascending: true });
            break;
          default:
            query = query
              .order('created_at', { ascending: false })
              .order('id', { ascending: true });
            break;
        }

        const { data, error } = (await query) as {
          data: RawStorefrontProductRow[] | null;
          error: unknown;
        };

        if (error) throw error;

        return data || [];
      };

      if (hasInMemoryFilters) {
        const targetProductCount =
          filters.limit ?? IN_MEMORY_FILTER_DEFAULT_TARGET;
        const pageSize = getInMemoryFilterPageSize(targetProductCount);
        const filteredProducts: RawStorefrontProductRow[] = [];
        let offset = 0;

        while (filteredProducts.length < targetProductCount) {
          const rangeTo = offset + pageSize - 1;
          const requestedCandidateCount = rangeTo - offset + 1;
          const products = await fetchProductRows({
            from: offset,
            to: rangeTo,
          });
          filteredProducts.push(
            ...applyInMemoryStorefrontFilters(products, filters)
          );

          if (products.length < requestedCandidateCount) {
            break;
          }

          offset += requestedCandidateCount;
        }
        return (
          await projectStandardListingRows(
            merchantId,
            filteredProducts.slice(0, targetProductCount),
            {
              condition: filters.condition,
              minPrice: filters.min_price,
              maxPrice: filters.max_price,
            }
          )
        ).map(storefrontProductsRouteData.mapProduct);
      }

      const products = await fetchProductRows();
      return (
        await projectStandardListingRows(merchantId, products, {
          condition: filters.condition,
          minPrice: filters.min_price,
          maxPrice: filters.max_price,
        })
      ).map(storefrontProductsRouteData.mapProduct);
    },
    cacheKeyParts,
    {
      revalidate: 300,
      tags: buildStorefrontProductsCacheTags(merchantId),
    }
  );
}

async function fetchProductsByIds(
  merchantId: string,
  ids: string[],
  options: { compact?: boolean } = {}
) {
  const products = await fetchProductRowsByIds(merchantId, ids, options);

  return (await projectStandardListingRows(merchantId, products)).map(
    storefrontProductsRouteData.mapProduct
  );
}

async function fetchProductRowsByIds(
  merchantId: string,
  ids: string[],
  options: { compact?: boolean } = {}
) {
  if (ids.length === 0) {
    return [];
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const selectColumns: string =
    options.compact === false
      ? storefrontProductsRouteData.STOREFRONT_PRODUCTS_SELECT
      : storefrontProductsRouteData.STOREFRONT_PRODUCTS_COMPACT_SELECT;

  const products: RawStorefrontProductRow[] = [];
  for (
    let index = 0;
    index < ids.length;
    index += PRODUCT_ID_FETCH_CHUNK_SIZE
  ) {
    const idChunk = ids.slice(index, index + PRODUCT_ID_FETCH_CHUNK_SIZE);
    const result = (await supabase
      .from('products')
      .select(selectColumns)
      .eq('merchant_id', merchantId)
      .eq('status', 'active')
      .in('id', idChunk)) as {
      data: RawStorefrontProductRow[] | null;
      error: unknown;
    };

    if (result.error) throw result.error;
    products.push(...(result.data || []));
  }

  return products;
}

function hasActiveStorefrontFilter(value: string | undefined) {
  return Boolean(value && !storefrontProductFilters.isAllFilter(value));
}

function hasRouteProductImage(product: RawStorefrontProductRow) {
  return Boolean(
    getPrimaryProductImage(
      product.images as Array<string | { url?: string | null }> | null
    )
  );
}

function matchesRouteProductFilters(
  product: RawStorefrontProductRow,
  filters: Pick<ProductFilters, 'brand' | 'category' | 'condition'> & {
    hasImages?: boolean;
  }
) {
  if (filters.hasImages && !hasRouteProductImage(product)) {
    return false;
  }

  if (
    filters.category &&
    !storefrontProductFilters.matchesStorefrontCategoryFilter(
      storefrontProductsRouteData.buildCategoryFilterSource(product),
      filters.category
    )
  ) {
    return false;
  }

  if (
    filters.brand &&
    !storefrontProductFilters.matchesStorefrontBrandFilter(
      product,
      filters.brand
    )
  ) {
    return false;
  }

  if (
    filters.condition &&
    !storefrontProductFilters.matchesStorefrontConditionFilter(
      product,
      filters.condition
    )
  ) {
    return false;
  }

  return true;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  try {
    const parsed = storefrontProductsQuerySchema.safeParse(
      Object.fromEntries(searchParams)
    );

    if (!parsed.success) {
      console.warn(
        'API Validation Failed:',
        JSON.stringify(parsed.error.flatten(), null, 2)
      );
      return NextResponse.json(
        { error: 'Invalid parameters', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const {
      merchant_id: merchantId,
      ids,
      category,
      brand,
      condition,
      compact,
      limit,
      offset,
      min_price,
      max_price,
      sort,
      q,
      has_images,
    } = parsed.data;

    if (!merchantId) {
      return NextResponse.json(
        { error: 'Merchant ID is required' },
        { status: 400 }
      );
    }

    if (ids) {
      const idList = ids.split(',').filter((id) => id.trim());
      if (idList.length === 0) {
        return NextResponse.json({ products: [] });
      }

      if (idList.length > 50) {
        return NextResponse.json(
          { error: 'Too many IDs requested. Maximum is 50.' },
          { status: 400 }
        );
      }

      const products = await fetchProductsByIds(merchantId, idList, {
        compact,
      });
      return NextResponse.json(
        { products },
        {
          headers: {
            'Cache-Control': 'private, max-age=60',
          },
        }
      );
    }

    if (q) {
      // Page ranked candidates when filters run in memory. search_products_v2
      // caps each page at 100, so filtered storefront responses must not stop at
      // a fixed pre-filter candidate window.
      const cookieStore = await cookies();
      const supabase = createClient(cookieStore);
      const requestedLimit = limit ?? 20;
      const searchSort = searchParams.has('sort')
        ? toStorefrontSearchSort(sort)
        : 'relevance';
      const usesInMemoryFilters =
        hasActiveStorefrontFilter(category) ||
        hasActiveStorefrontFilter(brand) ||
        hasActiveStorefrontFilter(condition) ||
        has_images === true;
      const searchFilters = {
        brand: null,
        condition: null,
        maxPrice: max_price ?? null,
        minPrice: min_price ?? null,
      };

      let rankedProductIds: string[];
      let didYouMean: string | null;
      // Exact RPC total when no in-memory filter narrows the result set.
      let dbCount: number | null;
      if (usesInMemoryFilters) {
        const candidates = await collectRankedSearchProductIds({
          supabase,
          merchantId,
          query: q,
          filters: searchFilters,
          sort: searchSort,
        });
        rankedProductIds = candidates.productIds;
        didYouMean = candidates.didYouMean;
        dbCount = null;
      } else {
        const ranked = await searchStorefrontProducts({
          supabase,
          merchantId,
          query: q,
          limit: requestedLimit,
          offset,
          filters: searchFilters,
          sort: searchSort,
        });
        rankedProductIds = ranked.productIds;
        didYouMean = ranked.didYouMean;
        dbCount = ranked.count;
      }

      if (rankedProductIds.length === 0) {
        return NextResponse.json(
          {
            products: [],
            didYouMean,
            count: dbCount ?? 0,
          },
          {
            headers: {
              'Cache-Control':
                'public, s-maxage=60, stale-while-revalidate=300',
            },
          }
        );
      }

      const productRows = await fetchProductRowsByIds(
        merchantId,
        rankedProductIds,
        { compact }
      );
      const order = new Map(
        rankedProductIds.map((id, index) => [id, index] as const)
      );
      const activeFilters = {
        brand: hasActiveStorefrontFilter(brand) ? brand : undefined,
        category: hasActiveStorefrontFilter(category) ? category : undefined,
        condition: hasActiveStorefrontFilter(condition) ? condition : undefined,
        hasImages: has_images === true ? true : undefined,
      };
      const filteredRows = productRows.filter((product) =>
        matchesRouteProductFilters(product, activeFilters)
      );
      filteredRows.sort(
        (a, b) =>
          (order.get(String(a.id)) ?? Number.MAX_SAFE_INTEGER) -
          (order.get(String(b.id)) ?? Number.MAX_SAFE_INTEGER)
      );
      const visibleOffset = usesInMemoryFilters ? (offset ?? 0) : 0;
      const visibleProducts = (
        await projectStandardListingRows(
          merchantId,
          filteredRows.slice(visibleOffset, visibleOffset + requestedLimit),
          { condition, minPrice: min_price, maxPrice: max_price }
        )
      ).map(storefrontProductsRouteData.mapProduct);
      const responseCount = usesInMemoryFilters
        ? filteredRows.length
        : (dbCount ?? filteredRows.length);

      return NextResponse.json(
        {
          products: visibleProducts,
          didYouMean,
          count: responseCount,
        },
        {
          headers: {
            'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
          },
        }
      );
    }

    const filters = {
      category: category || undefined,
      brand: brand || undefined,
      condition: condition || undefined,
      compact: compact ?? true,
      limit,
      min_price,
      max_price,
      sort,
      has_images: parsed.data.has_images,
      q: q || undefined,
    };

    const getCachedProducts = createCachedProductsFetcher(merchantId, filters);
    const mappedProducts = await getCachedProducts();

    return NextResponse.json(
      { products: mappedProducts },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
        },
      }
    );
  } catch (error) {
    console.error('Unexpected error in GET /api/storefront/products:', {
      ...formatSupabaseErrorLog(error),
      merchantId: searchParams.get('merchant_id'),
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
