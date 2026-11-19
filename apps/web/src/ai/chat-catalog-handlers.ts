import type { SupabaseClient } from '@supabase/supabase-js';
import { CHAT_PRODUCT_PROJECTION } from '@/ai/chat-product-projection';
import {
  type ChatProductResult,
  createChatProductResult,
} from '@/ai/chat-product-result';
import {
  type AgenticChatTenant,
  resolveAgenticChatTenant,
} from '@/lib/agentic/agentic-chat-tenant';
import { sanitizeSearchQuery } from '@/lib/sanitize-core';
import { searchStorefrontProducts } from '@/lib/storefront-search';
import { createPublicClient } from '@/lib/supabase/public';
import type {
  GetProductDetailsParams,
  GetRecommendationsParams,
  SearchProductsParams,
} from './chat-tools';

type ChatToolSupabaseClient = Pick<SupabaseClient, 'from' | 'rpc'>;

async function resolveChatCatalogTenant(): Promise<AgenticChatTenant | null> {
  return await resolveAgenticChatTenant();
}

function createChatCatalogSupabaseClient(): ChatToolSupabaseClient {
  return createPublicClient({ clientInfo: 'baci-chat-catalog' });
}

// ============================================
// SEARCH PRODUCTS
// ============================================

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
  const tenant = await resolveChatCatalogTenant();
  if (!tenant) return { products: [], total: 0 };

  const supabase = createChatCatalogSupabaseClient();
  const merchantId = tenant.merchantId;
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
        merchantId,
        query: searchText,
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

export async function handleGetProductDetails(
  params: GetProductDetailsParams
): Promise<ChatProductResult | null> {
  const tenant = await resolveChatCatalogTenant();
  if (!tenant) return null;

  const supabase = createChatCatalogSupabaseClient();
  const merchantId = tenant.merchantId;

  try {
    const { data, error } = await supabase
      .from('products')
      .select(CHAT_PRODUCT_PROJECTION)
      .eq('id', params.productId)
      .eq('merchant_id', merchantId)
      .eq('status', 'active')
      .single();

    if (error || !data) {
      if (error) {
        console.error('[Chat Tools] Product detail error:', error);
      }
      return null;
    }

    return createChatProductResult(data);
  } catch (err) {
    console.error('[Chat Tools] Product detail error:', err);
    return null;
  }
}

// ============================================
// GET RECOMMENDATIONS
// ============================================

export async function handleGetRecommendations(
  params: GetRecommendationsParams
): Promise<ChatProductResult[]> {
  const tenant = await resolveChatCatalogTenant();
  if (!tenant) return [];

  const supabase = createChatCatalogSupabaseClient();
  const merchantId = tenant.merchantId;

  try {
    // First get the source product
    const { data: sourceProduct, error: sourceError } = await supabase
      .from('products')
      .select('id, name, price, category, brand')
      .eq('id', params.productId)
      .eq('merchant_id', merchantId)
      .eq('status', 'active')
      .maybeSingle();

    if (sourceError || !sourceProduct) {
      if (sourceError)
        console.error('[Chat Tools] Source product error:', sourceError);
      return [];
    }

    let query = supabase
      .from('products')
      .select(CHAT_PRODUCT_PROJECTION)
      .eq('merchant_id', merchantId)
      .eq('status', 'active')
      .neq('id', params.productId)
      .limit(3);

    if (params.type === 'upsell') {
      // Same category, higher price (10-50% more)
      query = query
        .eq('category', sourceProduct.category)
        .gt('price', sourceProduct.price * 1.1)
        .lt('price', sourceProduct.price * 1.5)
        .order('price', { ascending: true });
    } else if (params.type === 'cross_sell') {
      // Complementary categories
      const complementaryCategories = getComplementaryCategories(
        sourceProduct.category
      );
      query = query
        .in('category', complementaryCategories)
        .order('price', { ascending: false });
    } else {
      // Accessories - same brand, lower price
      query = query
        .eq('brand', sourceProduct.brand)
        .lt('price', sourceProduct.price * 0.3)
        .order('price', { ascending: false });
    }

    const { data, error: recError } = await query;

    if (recError) {
      console.error('[Chat Tools] Recommendations error:', recError);
      return [];
    }

    return (data || []).map(createChatProductResult);
  } catch (err) {
    console.error('[Chat Tools] Recommendations error:', err);
    return [];
  }
}

// Helper: Get complementary categories
function getComplementaryCategories(category: string | null): string[] {
  const categoryPairs: Record<string, string[]> = {
    Smartphones: ['Accessories', 'Tablets', 'Wearables'],
    Laptops: ['Accessories', 'Monitors', 'Keyboards'],
    Gaming: ['Accessories', 'Monitors', 'Headphones'],
    Tablets: ['Accessories', 'Keyboards', 'Styluses'],
    Audio: ['Accessories', 'Smartphones', 'Wearables'],
  };

  return categoryPairs[category || ''] || ['Accessories'];
}
