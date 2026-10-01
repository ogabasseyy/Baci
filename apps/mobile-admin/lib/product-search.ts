import {
  extractProductSearchIds,
  getProductSearchTotalCount,
  orderRecordsByIds,
} from '@baci/shared';
import { sanitizeSearchQuery } from '@/lib/sanitize';
import { supabase } from '@/lib/supabase';
import type { AdminProductStockFilter } from './product-search-filters';
import {
  applyAdminProductStockAndVisibilityFilter,
  applyAdminProductStockFilter,
} from './product-search-filters';

export type { AdminProductStockFilter } from './product-search-filters';
export {
  ADMIN_EFFECTIVE_IN_STOCK_FILTER,
  ADMIN_EFFECTIVE_LOW_STOCK_FILTER,
  ADMIN_EFFECTIVE_OUT_OF_STOCK_FILTER,
  applyAdminProductStockFilter,
} from './product-search-filters';

export type AdminProductStatus = 'active' | 'draft' | 'archived';

export interface AdminProductSearchFilters {
  category?: string;
  /** Include archived products for historical reconciliation workflows. */
  includeArchived?: boolean;
  search?: string;
  status?: AdminProductStatus;
  stockFilter?: AdminProductStockFilter;
}

export interface AdminProductSearchPage<T extends { id: string }> {
  nextCursor: number | null;
  rows: T[];
  totalCount: number;
}

const ADMIN_SEARCH_STOCK_FILTERS: Record<AdminProductStockFilter, string> = {
  in_stock: 'admin_in_stock',
  low_stock: 'admin_low_stock',
  out_of_stock: 'admin_out_of_stock',
};
const ADMIN_SEARCH_VISIBLE_STATUS_FILTER = 'not_archived';

function normalizeAdminSearchInput(search: string | undefined) {
  return sanitizeSearchQuery(search ?? '').trim();
}

function clampPositiveInteger(value: number, maximum: number) {
  const normalizedValue = Number.isFinite(value) ? Math.trunc(value) : 1;
  return Math.min(Math.max(normalizedValue, 1), maximum);
}

function getAdminSearchStatusFilter(filters: AdminProductSearchFilters) {
  if (filters.status) return filters.status;
  if (filters.includeArchived) return null;
  return ADMIN_SEARCH_VISIBLE_STATUS_FILTER;
}

function getAdminSearchStockFilter(filters: AdminProductSearchFilters) {
  return filters.stockFilter
    ? ADMIN_SEARCH_STOCK_FILTERS[filters.stockFilter]
    : null;
}

export async function fetchAdminProductSearchRows<
  T extends { id: string },
>(args: {
  cursor: number;
  filters: AdminProductSearchFilters;
  merchantId: string;
  pageSize: number;
  selectColumns: string;
}): Promise<AdminProductSearchPage<T>> {
  const searchTerm = normalizeAdminSearchInput(args.filters.search);
  const safePageSize = clampPositiveInteger(args.pageSize, 100);
  if (!searchTerm) {
    return {
      nextCursor: null,
      rows: [],
      totalCount: 0,
    };
  }

  const { data: searchResults, error: searchError } = await supabase.rpc(
    'search_products_v2',
    {
      brand_filter: null,
      category_id_filter: args.filters.category ?? null,
      condition_filter: null,
      max_price_filter: null,
      merchant_id_param: args.merchantId,
      min_price_filter: null,
      min_rating_filter: null,
      parent_only: true,
      result_limit: safePageSize,
      result_offset: args.cursor,
      search_query: searchTerm,
      sort_by: 'relevance',
      status_filter: getAdminSearchStatusFilter(args.filters),
      stock_filter: getAdminSearchStockFilter(args.filters),
    }
  );

  if (searchError) {
    throw new Error(searchError.message);
  }

  const productIds = extractProductSearchIds(searchResults ?? []);
  const totalCount = getProductSearchTotalCount(searchResults ?? []);
  if (productIds.length === 0) {
    return {
      nextCursor: null,
      rows: [],
      totalCount,
    };
  }

  let rowsQuery = supabase
    .from('products')
    .select(args.selectColumns)
    .eq('merchant_id', args.merchantId)
    .is('parent_product_id', null)
    .in('id', productIds);

  if (args.filters.status)
    rowsQuery = rowsQuery.eq('status', args.filters.status);
  if (args.filters.category) {
    rowsQuery = rowsQuery.eq('category_id', args.filters.category);
  }
  const shouldHideArchived =
    !args.filters.status && !args.filters.includeArchived;
  if (shouldHideArchived && args.filters.stockFilter) {
    rowsQuery = applyAdminProductStockAndVisibilityFilter(
      rowsQuery,
      args.filters.stockFilter
    );
  } else {
    if (shouldHideArchived) {
      rowsQuery = rowsQuery.or('status.neq.archived,status.is.null');
    }
    rowsQuery = applyAdminProductStockFilter(
      rowsQuery,
      args.filters.stockFilter
    );
  }

  const { data, error } = await rowsQuery;

  if (error) {
    throw new Error(error.message);
  }

  const rowsData = Array.isArray(data) ? (data as unknown as T[]) : [];
  const rows = orderRecordsByIds(rowsData, productIds);
  const nextCursor =
    args.cursor + safePageSize < totalCount ? args.cursor + safePageSize : null;

  return {
    nextCursor,
    rows,
    totalCount,
  };
}

export async function fetchAdminProductSuggestionCandidates<
  T extends { id: string },
>(args: {
  excludeProductId?: string;
  limit: number;
  merchantId: string;
  productName: string;
  selectColumns: string;
}): Promise<T[]> {
  const searchTerm = normalizeAdminSearchInput(args.productName);
  const safeLimit = clampPositiveInteger(args.limit, 50);
  if (searchTerm.length < 2) {
    return [];
  }

  const { data: searchResults, error: searchError } = await supabase.rpc(
    'search_products_v2',
    {
      brand_filter: null,
      category_id_filter: null,
      condition_filter: null,
      max_price_filter: null,
      merchant_id_param: args.merchantId,
      min_price_filter: null,
      min_rating_filter: null,
      parent_only: true,
      result_limit: Math.max(safeLimit * 3, 12),
      result_offset: 0,
      search_query: searchTerm,
      sort_by: 'relevance',
      status_filter: null,
      stock_filter: null,
    }
  );

  if (searchError) {
    throw new Error(searchError.message);
  }

  const productIds = extractProductSearchIds(searchResults ?? []).filter(
    (productId) => productId !== args.excludeProductId
  );

  if (productIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from('products')
    .select(args.selectColumns)
    .eq('merchant_id', args.merchantId)
    .is('parent_product_id', null)
    .in('id', productIds);

  if (error) {
    throw new Error(error.message);
  }

  const rowsData = Array.isArray(data) ? (data as unknown as T[]) : [];

  return orderRecordsByIds(rowsData, productIds).slice(0, safeLimit);
}
