import {
  getRefinedSearchArgs,
  readRefinedSearchRows,
  type SearchRefinements,
} from '@baci/shared/lib';
import { cookies } from 'next/headers';
import { availableSearchFacetsSchema } from '@/schemas/available-search-facets';
import { normalizeProduct } from './normalize-product';
import { STOREFRONT_PRODUCTS_COMPACT_SELECT } from './storefront-products-select';
import { findStorefrontSearchDidYouMean } from './storefront-search-did-you-mean';
import type { StorefrontSearchProductsPage } from './storefront-search-products';
import { createClient } from './supabase/server';

export async function getStorefrontRefinedSearchProducts(args: {
  merchantId: string;
  query: string;
  limit: number;
  offset?: number;
  refinements: SearchRefinements;
}): Promise<StorefrontSearchProductsPage> {
  const supabase = createClient(await cookies());
  const { data, error } = await supabase.rpc(
    args.refinements.processor
      ? 'search_storefront_products_processor_refined'
      : 'search_storefront_products_refined',
    getRefinedSearchArgs(
      args.merchantId,
      args.query,
      args.refinements,
      args.limit,
      args.offset
    )
  );
  if (error) throw new Error('Search results unavailable');
  const matches = readRefinedSearchRows(data);
  if (!matches.length)
    return {
      count: 0,
      products: [],
      productIds: [],
      query: args.query,
      didYouMean: await findStorefrontSearchDidYouMean({
        supabase,
        merchantId: args.merchantId,
        query: args.query,
      }),
    };
  const { data: raw, error: readError } = await supabase
    .from('products')
    .select(STOREFRONT_PRODUCTS_COMPACT_SELECT)
    .eq('merchant_id', args.merchantId)
    .eq('status', 'active')
    .in(
      'id',
      matches.map((r) => r.productId)
    );
  if (readError) throw new Error('Search results unavailable');
  const rows = new Map((raw ?? []).map((row) => [row.id, row]));
  // A matched row can vanish between the RPC snapshot and this read
  // (deactivated, unpublished, or RLS-filtered mid-request). Skip it and
  // render the surviving matches: failing the whole page over one stale
  // id is worse than a self-healing off-by-one count.
  const products = matches.flatMap((match) => {
    const row = rows.get(match.productId);
    if (!row) return [];
    const product = normalizeProduct(row as never);
    // Keep price and option identity aligned with global SQL price sorting;
    // unconstrained browsing still advertises every available condition.
    return [
      {
        ...product,
        price: match.price ?? product.price,
        condition: match.condition ?? product.condition,
        available_conditions:
          match.condition &&
          (args.refinements.condition !== undefined ||
            args.refinements.minPrice !== undefined ||
            args.refinements.maxPrice !== undefined)
            ? [match.condition]
            : product.available_conditions,
        searchMatch: match,
      },
    ];
  });
  return {
    count: matches[0].total,
    products,
    productIds: products.map((p) => p.searchMatch.productId),
    query: args.query,
    didYouMean: null,
  };
}

export async function getStorefrontSearchFacets(
  merchantId: string,
  query: string,
  criteria: SearchRefinements
) {
  const supabase = createClient(await cookies());
  const { data, error } = await supabase.rpc(
    criteria.categoryId
      ? 'get_storefront_search_category_facets'
      : 'get_storefront_search_available_facets',
    {
      search_query: query,
      merchant_id_param: merchantId,
      ...(criteria.categoryId
        ? { category_id_param: criteria.categoryId }
        : {}),
    }
  );
  const parsed = availableSearchFacetsSchema.safeParse(data);
  if (error || !parsed.success) throw new Error('Filter options unavailable');
  return parsed.data;
}
