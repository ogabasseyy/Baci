import { cacheLife, cacheTag } from 'next/cache';
import { getCategoryPageDataCacheTag } from '@/lib/category-page-cache-tags';
import { createStorefrontReadDeadline } from '@/lib/create-storefront-read-deadline';
import {
  prepareStorefrontSingleAttemptQuery,
  type StorefrontSingleAttemptQuery,
} from '@/lib/prepare-storefront-single-attempt-query';
import { getPublicSupabaseClient } from '@/lib/public-supabase-client';
import { getCachedCompareCategoryShell } from '@/lib/storefront-compare/get-cached-compare-category-shell';
import {
  getProductSeoSelect,
  mergeProductCandidates,
  type ProductSeoRow,
  toProductSemanticCandidate,
} from './get-product-seo-link-inventory-normalize';
import { PDP_SEMANTIC_INVENTORY_LIMIT } from './pdp-semantic-inventory-limit';
import type { ProductSemanticCandidate } from './product-semantic-types';

const PDP_SEMANTIC_INVENTORY_TIMEOUT_MS = 3_000;
export const PDP_SEMANTIC_TOTAL_TIMEOUT_MS = 5_000;

type BoundedInventoryQuery = {
  order: (
    column: string,
    options: { ascending: boolean }
  ) => BoundedInventoryQuery;
  limit: (count: number) => unknown;
};

function boundInventoryQuery(query: BoundedInventoryQuery) {
  return query
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })
    .limit(
      PDP_SEMANTIC_INVENTORY_LIMIT
    ) as unknown as StorefrontSingleAttemptQuery<{
    data: ProductSeoRow[] | null;
    error: unknown;
  }>;
}

function compareInventoryRows(left: ProductSeoRow, right: ProductSeoRow) {
  const leftCreatedAt = left.created_at ?? '';
  const rightCreatedAt = right.created_at ?? '';
  if (leftCreatedAt !== rightCreatedAt) {
    return leftCreatedAt < rightCreatedAt ? 1 : -1;
  }
  const leftId = left.id ?? '';
  const rightId = right.id ?? '';
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

function normalizeInventoryRows(
  rows: ProductSeoRow[],
  categorySlug: string
): ProductSemanticCandidate[] {
  return mergeProductCandidates(
    rows
      .sort(compareInventoryRows)
      .map((row) => toProductSemanticCandidate(row, categorySlug))
      .filter(
        (candidate): candidate is ProductSemanticCandidate => candidate !== null
      )
  ).slice(0, PDP_SEMANTIC_INVENTORY_LIMIT);
}

/**
 * Loads the small candidate pool used by the PDP semantic sections.
 *
 * The cache key is merchant + category, not merchant + product. The previous
 * combined snapshot RPC rebuilt this same category pool for every PDP and
 * coupled it to the product-guide and cluster-guide reads. Keeping the pool
 * as its own local cache entry lets neighboring PDPs reuse one bounded read
 * while still throwing on a transient fill failure (so an empty pool is never
 * persisted as a successful snapshot).
 */
export async function getCachedPdpSemanticInventory(
  merchantId: string,
  categorySlug: string
): Promise<ProductSemanticCandidate[]> {
  // The cache key is computed before a `'use cache'` function body runs. Keep
  // bot-controlled category values outside that boundary; the PDP route's
  // canonical product category is normally already slug-safe, but this guard
  // also protects direct callers and malformed legacy URLs.
  const normalizedCategorySlug = categorySlug.trim().toLowerCase();
  if (
    !normalizedCategorySlug ||
    normalizedCategorySlug.length > 64 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalizedCategorySlug)
  ) {
    return [];
  }

  const deadline = createStorefrontReadDeadline(PDP_SEMANTIC_TOTAL_TIMEOUT_MS);
  try {
    return await Promise.race([
      getCachedPdpSemanticInventoryForSafeCategory(
        merchantId,
        normalizedCategorySlug
      ),
      deadline.promise,
    ]);
  } finally {
    deadline.cleanup();
  }
}

async function getCachedPdpSemanticInventoryForSafeCategory(
  merchantId: string,
  categorySlug: string
): Promise<ProductSemanticCandidate[]> {
  'use cache';

  try {
    cacheLife('products');
    cacheTag(
      'products',
      'categories',
      `products-${merchantId}`,
      `categories-${merchantId}`,
      getCategoryPageDataCacheTag(merchantId),
      `seo-pdp-inventory-${merchantId}-${categorySlug}`
    );
  } catch {
    // Unit tests do not run with Next cacheComponents enabled.
  }

  const shell = await getCachedCompareCategoryShell(merchantId, categorySlug);

  if (shell.isCollection || shell.productScope.kind === 'none') {
    return [];
  }

  const supabase = getPublicSupabaseClient();
  const scope = shell.productScope;
  const isCategoryScoped = scope.kind === 'category';
  let query = supabase
    .from('products')
    .select(getProductSeoSelect(isCategoryScoped))
    .eq('merchant_id', merchantId)
    .eq('status', 'active');

  if (scope.kind === 'category') {
    if (scope.categoryIds.length === 0) return [];
    const ids = scope.categoryIds;
    const deadline = createStorefrontReadDeadline(
      PDP_SEMANTIC_INVENTORY_TIMEOUT_MS
    );
    const directQueryBase = supabase
      .from('products')
      .select(getProductSeoSelect(false))
      .eq('merchant_id', merchantId)
      .eq('status', 'active')
      .in('category_id', ids)
      .order('created_at', { ascending: false });
    const directQuery = boundInventoryQuery(directQueryBase);
    const joinedQuery = boundInventoryQuery(
      query.in('product_categories.category_id', ids)
    );
    try {
      const [direct, joined] = await Promise.race([
        Promise.all(
          [directQuery, joinedQuery].map((candidate) =>
            Promise.resolve(
              prepareStorefrontSingleAttemptQuery(candidate, deadline.signal)
            )
          )
        ),
        deadline.promise,
      ]);
      if (direct.error) throw direct.error;
      if (joined.error) throw joined.error;
      return normalizeInventoryRows(
        [
          ...((direct.data ?? []) as ProductSeoRow[]),
          ...((joined.data ?? []) as ProductSeoRow[]),
        ],
        categorySlug
      );
    } finally {
      deadline.cleanup();
    }
  } else if (scope.kind === 'legacy') {
    const sanitizedCategoryName = scope.categoryName.replace(/[,().]/g, '');
    if (!sanitizedCategoryName) return [];
    query = query.or(
      `category.ilike.%${sanitizedCategoryName}%,brand.ilike.%${sanitizedCategoryName}%,name.ilike.%${sanitizedCategoryName}%`
    );
  }

  const boundedQuery = boundInventoryQuery(query);
  const deadline = createStorefrontReadDeadline(
    PDP_SEMANTIC_INVENTORY_TIMEOUT_MS
  );
  let data: ProductSeoRow[] | null;
  let error: unknown;
  try {
    ({ data, error } = await Promise.race([
      Promise.resolve(
        prepareStorefrontSingleAttemptQuery(boundedQuery, deadline.signal)
      ),
      deadline.promise,
    ]));
  } finally {
    deadline.cleanup();
  }

  if (error) {
    throw error;
  }

  return normalizeInventoryRows(data ?? [], categorySlug);
}
