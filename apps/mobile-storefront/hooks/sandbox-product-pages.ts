import { withSupabaseRetry } from '@/lib/api';
import { createLogger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';
import type { Product } from '@/types/product';
import {
  hydrateRowsNeedingBaseInventory,
  hydrateRowsNeedingStorefrontVariants,
} from './product-hydration';
import { SANDBOX_PRODUCT_SELECT } from './product-select';
import { transformProduct } from './product-transform';
import type { ProductsPage, UseProductsOptions } from './product-utils.types';
import {
  getSandboxProcessorFamily,
  sortSandboxProducts,
} from './sandbox-product-refinements';

const log = createLogger('Products');
const PROCESSOR_SCAN_PAGE_SIZE = 500;
const PROCESSOR_SCAN_MAX_ROWS = 10_000;

function isAvailableBaseProduct(row: Record<string, unknown>) {
  // The fallback has no safe projection for variant/offer prices or strict
  // serialized availability. Refuse these rows instead of approximating them.
  if (
    row.has_variants !== false ||
    row.variant_model === 'sku_matrix' ||
    row.has_condition_offers === true
  ) {
    throw new Error('Sandbox search refinements unavailable');
  }

  const trackingPolicy = row.inventory_tracking_policy;
  if (trackingPolicy === 'serialized_strict') {
    throw new Error('Sandbox search refinements unavailable');
  }
  if (trackingPolicy === 'serialized_then_unlimited') return true;
  // Match SQL's `manage_stock IS FALSE`: NULL still requires positive stock.
  if (row.manage_stock === false) return true;

  const stockQuantity =
    typeof row.stock_quantity === 'number' ? row.stock_quantity : null;
  const stock = typeof row.stock === 'number' ? row.stock : null;
  const availableQuantity =
    stockQuantity === 0 && stock !== null && stock > 0
      ? stock
      : (stockQuantity ?? stock ?? 0);
  return availableQuantity > 0;
}

function matchesSandboxCondition(
  row: Record<string, unknown>,
  condition: string | null | undefined
) {
  if (!condition) return true;
  const rowCondition =
    typeof row.condition === 'string' ? row.condition : 'new';
  const accepted =
    condition === 'used'
      ? ['used', 'uk_used']
      : condition === 'open_box'
        ? ['open_box', 'refurbished']
        : [condition];
  return accepted.includes(rowCondition);
}

export function buildSandboxProductQuery(
  merchantId: string,
  normalizedSearch: string,
  options: UseProductsOptions,
  normalizedCondition: string | null | undefined,
  countOnly = false,
  processorCandidateScan = false
) {
  const refinements = options.refinements;
  let query = supabase
    .from('products')
    .select(SANDBOX_PRODUCT_SELECT, {
      count: 'exact',
      ...(countOnly ? { head: true } : {}),
    })
    .eq('merchant_id', merchantId)
    .eq('status', 'active');

  // The staging fallback deliberately supports literal name matching only;
  // the unavailable search RPC also supplies SKU, fuzzy, and ranked matches.
  if (normalizedSearch) query = query.ilike('name', `%${normalizedSearch}%`);

  const categoryId = refinements?.categoryId ?? options.category;
  if (categoryId) query = query.eq('category_id', categoryId);

  const condition = processorCandidateScan
    ? undefined
    : (refinements?.condition ?? normalizedCondition);
  if (condition) {
    const conditions =
      condition === 'used'
        ? ['used', 'uk_used']
        : condition === 'open_box'
          ? ['open_box', 'refurbished']
          : [condition];
    query = query.or(
      `condition.eq.${condition},available_conditions.cs.{${conditions.join(',')}}`
    );
  }

  const brands = refinements?.brands.filter(Boolean) ?? [];
  if (brands.length > 0) query = query.in('brand', brands);
  if (options.brand) query = query.eq('brand', options.brand);

  const minPrice = processorCandidateScan
    ? undefined
    : (refinements?.minPrice ?? options.minPrice);
  if (minPrice !== undefined) query = query.gte('price', minPrice);
  const maxPrice = processorCandidateScan
    ? undefined
    : (refinements?.maxPrice ?? options.maxPrice);
  if (maxPrice !== undefined) query = query.lte('price', maxPrice);
  const minRating = refinements?.minRating ?? options.minRating;
  if (minRating !== undefined && minRating > 0) {
    query = query.gte('average_rating', minRating);
  }

  return query;
}

export function getSandboxProductSort(options: UseProductsOptions) {
  return options.refinements?.sort ?? options.sortBy ?? 'newest';
}

async function countSandboxProcessorCandidates(
  merchantId: string,
  normalizedSearch: string,
  options: UseProductsOptions,
  normalizedCondition: string | null | undefined
) {
  const query = buildSandboxProductQuery(
    merchantId,
    normalizedSearch,
    options,
    normalizedCondition,
    true,
    true
  );
  const { count, error } = await withSupabaseRetry(async () => await query, {
    maxRetries: 3,
    onRetry: (attempt) => log.warn(`Retry ${attempt}`),
  });
  if (error) throw error;
  if (count === null) throw new Error('Sandbox search refinements unavailable');
  return count;
}

export async function fetchSandboxProcessorRefinementsPage(
  merchantId: string,
  normalizedSearch: string,
  options: UseProductsOptions,
  normalizedCondition: string | null | undefined,
  limit: number,
  offset: number
): Promise<ProductsPage> {
  const processor = options.refinements?.processor;
  if (!processor) return { products: [], total: 0, nextOffset: null };
  const normalizedProcessor = processor.trim().toLocaleLowerCase();

  const candidateCount = await countSandboxProcessorCandidates(
    merchantId,
    normalizedSearch,
    options,
    normalizedCondition
  );
  if (candidateCount > PROCESSOR_SCAN_MAX_ROWS) {
    throw new Error('Sandbox search refinements unavailable');
  }

  const candidates: Record<string, unknown>[] = [];
  let lastId: string | null = null;
  while (candidates.length < candidateCount) {
    const scanQuery = buildSandboxProductQuery(
      merchantId,
      normalizedSearch,
      options,
      normalizedCondition,
      false,
      true
    )
      .order('id', { ascending: true })
      .limit(PROCESSOR_SCAN_PAGE_SIZE);
    if (lastId) scanQuery.gt('id', lastId);
    const { data, error } = await withSupabaseRetry(
      async () => await scanQuery,
      {
        maxRetries: 3,
        onRetry: (attempt, err) =>
          log.warn(`Sandbox refinement scan retry ${attempt}: ${err.message}`),
      }
    );
    if (error) throw error;
    const page = (data ?? []) as Record<string, unknown>[];
    const expected = Math.min(
      PROCESSOR_SCAN_PAGE_SIZE,
      candidateCount - candidates.length
    );
    const nextId = page.at(-1)?.id;
    if (
      page.length !== expected ||
      typeof nextId !== 'string' ||
      (lastId !== null && nextId <= lastId)
    ) {
      throw new Error('Sandbox search refinements unavailable');
    }
    candidates.push(...page);
    lastId = nextId;
  }
  const finalCandidateCount = await countSandboxProcessorCandidates(
    merchantId,
    normalizedSearch,
    options,
    normalizedCondition
  );
  if (finalCandidateCount !== candidateCount) {
    throw new Error('Sandbox search refinements unavailable');
  }

  // Separate PostgREST requests are not a database snapshot. The before/after
  // count catches cardinality changes, but same-count row replacements can
  // still escape detection.
  const filtered = sortSandboxProducts(
    candidates.filter((product) => {
      const family = getSandboxProcessorFamily(product.specifications);
      if (!family || family.toLocaleLowerCase() !== normalizedProcessor) {
        return false;
      }
      if (!isAvailableBaseProduct(product)) return false;
      const condition = options.refinements?.condition ?? normalizedCondition;
      if (!matchesSandboxCondition(product, condition)) return false;
      const minPrice = options.refinements?.minPrice ?? options.minPrice;
      if (minPrice !== undefined && Number(product.price) < minPrice) {
        return false;
      }
      const maxPrice = options.refinements?.maxPrice ?? options.maxPrice;
      return maxPrice === undefined || Number(product.price) <= maxPrice;
    }),
    getSandboxProductSort(options)
  );
  const total = filtered.length;
  const pageOffset = Math.max(0, Math.trunc(offset));
  const pageLimit = Math.max(1, Math.trunc(limit));
  const pageRows = filtered.slice(pageOffset, pageOffset + pageLimit);
  const hydratedRows = await hydrateRowsNeedingBaseInventory(
    await hydrateRowsNeedingStorefrontVariants(pageRows)
  );
  const products = hydratedRows
    .map(transformProduct)
    .filter((product): product is Product => product !== null);

  return {
    products,
    total,
    nextOffset: pageOffset + pageLimit < total ? pageOffset + pageLimit : null,
  };
}
