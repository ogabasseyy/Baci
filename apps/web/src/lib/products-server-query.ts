import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  MigrationFilterValue,
  StatusFilterValue,
} from '@/lib/product-list-filters';
import { PRODUCT_WITH_VARIANTS_QUERY } from '@/lib/product-queries';
import { sanitizeLikePattern } from '@/lib/sanitize-core';

export interface MerchantProductsQueryOptions {
  merchantId: string;
  status: StatusFilterValue;
  migration: MigrationFilterValue;
  search: string;
  paginateInDatabase: boolean;
  offset: number;
  limit: number;
}

/**
 * Builds the protected merchant-scoped Supabase query against `merchant_products`
 * with status, migration, search, and database pagination filters applied.
 */
export function buildMerchantProductsQuery(
  supabase: SupabaseClient,
  {
    merchantId,
    status,
    migration,
    search,
    paginateInDatabase,
    offset,
    limit,
  }: MerchantProductsQueryOptions
) {
  let query = supabase
    .from('merchant_products')
    .select(PRODUCT_WITH_VARIANTS_QUERY, { count: 'exact' })
    .eq('merchant_id', merchantId)
    .order('created_at', { ascending: false });

  if (status !== 'All') {
    query = query.eq('status', status);
  }

  if (migration !== 'All') {
    query =
      migration === 'pending'
        ? query.or('migration_status.eq.pending,migration_status.is.null')
        : query.eq('migration_status', migration);
  }

  if (search.trim()) {
    const sanitizedPattern = sanitizeLikePattern(search);
    query = query.or(
      `name.ilike.%${sanitizedPattern}%,sku.ilike.%${sanitizedPattern}%,description.ilike.%${sanitizedPattern}%`
    );
  }

  if (paginateInDatabase) {
    query = query.range(offset, offset + limit - 1);
  }

  return query;
}
