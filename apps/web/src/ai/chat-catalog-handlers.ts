import { getChatCatalogContext } from '@/ai/chat-catalog-context';
import { CHAT_PRODUCT_PROJECTION } from '@/ai/chat-product-projection';
import {
  type ChatProductResult,
  createChatProductResult,
} from '@/ai/chat-product-result';
import type { SearchProductsParams } from '@/ai/chat-tools';
import { sanitizeSearchQuery } from '@/lib/sanitize-core';
import { searchStorefrontProducts } from '@/lib/storefront-search';

function buildChatSearchText(params: SearchProductsParams): string {
  return [params.query, params.category]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => sanitizeSearchQuery(value).trim())
    .filter(Boolean)
    .join(' ');
}

function orderProductsByRankedIds<T extends { id: string }>(
  products: T[],
  rankedIds: string[]
): T[] {
  const order = new Map(rankedIds.map((id, index) => [id, index] as const));
  return [...products].sort(
    (a, b) =>
      (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(b.id) ?? Number.MAX_SAFE_INTEGER)
  );
}

export async function handleSearchProducts(
  params: SearchProductsParams
): Promise<{ products: ChatProductResult[]; total: number }> {
  const { supabase, merchantId } = await getChatCatalogContext();
  const searchText = buildChatSearchText(params);
  let ranked: Awaited<ReturnType<typeof searchStorefrontProducts>> | null =
    null;

  if (searchText) {
    try {
      ranked = await searchStorefrontProducts({
        supabase,
        filters: {
          maxPrice: params.maxPrice ?? null,
          minPrice: params.minPrice ?? null,
        },
        limit: 10,
        merchantId: merchantId,
        query: searchText,
        trackAnalytics: false,
      });
    } catch (error) {
      console.error('[Chat Tools] Search ranking error:', error);
      throw new Error('Catalog search temporarily unavailable');
    }
  }

  let query = supabase
    .from('products')
    .select(CHAT_PRODUCT_PROJECTION)
    .eq('merchant_id', merchantId)
    .eq('status', 'active')
    .order('price', { ascending: false })
    .limit(10);

  if (ranked) {
    if (ranked.productIds.length === 0) {
      return { products: [], total: ranked.count };
    }
    query = query.in('id', ranked.productIds);
  }

  // Apply price filters
  if (params.maxPrice !== undefined) {
    query = query.lte('price', params.maxPrice);
  }
  if (params.minPrice !== undefined) {
    query = query.gte('price', params.minPrice);
  }

  const { data, error, count } = await query;

  if (error) {
    console.error('[Chat Tools] Search error:', error);
    throw new Error('Catalog search temporarily unavailable');
  }

  const mappedProducts = (data || []).map(createChatProductResult);
  const products = ranked
    ? orderProductsByRankedIds(mappedProducts, ranked.productIds)
    : mappedProducts;

  return { products, total: ranked?.count ?? (count || products.length) };
}

// ============================================
// GET PRODUCT DETAILS
// ============================================
