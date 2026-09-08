/**
 * Chat Tool Handlers
 *
 * Implements the actual logic for each AI tool.
 * These handlers are called when the AI invokes a tool.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { CHAT_PRODUCT_PROJECTION } from '@/ai/chat-product-projection';
import {
  type ChatProductResult,
  createChatProductResult,
} from '@/ai/chat-product-result';
import { createAgenticScopedSupabaseClient } from '@/lib/agentic/scoped-supabase';
import { sanitizeSearchQuery } from '@/lib/sanitize-core';
import { searchStorefrontProducts } from '@/lib/storefront-search';
import type {
  AddToCartParams,
  CheckPaymentStatusParams,
  CreateVirtualAccountParams,
  GetProductDetailsParams,
  GetRecommendationsParams,
  SearchProductsParams,
} from './chat-tools';

// Ogabassey merchant ID (hardcoded for now, can be made dynamic)
const OGABASSEY_MERCHANT_ID = '3bc72679-c0f7-4db4-9054-6a4a4a95a498';
const OGABASSEY_MERCHANT_SLUG = 'ogabassey';

type ChatToolSupabaseClient = Pick<SupabaseClient, 'from' | 'rpc'>;

function createChatToolSupabaseClient(
  sessionId?: string
): ChatToolSupabaseClient {
  return createAgenticScopedSupabaseClient({
    merchantId: OGABASSEY_MERCHANT_ID,
    merchantSlug: OGABASSEY_MERCHANT_SLUG,
    sessionId,
  });
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
  const supabase = createChatToolSupabaseClient();
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
        merchantId: OGABASSEY_MERCHANT_ID,
        query: searchText,
        trackAnalytics: false,
      });
    } catch (error) {
      console.error('[Chat Tools] Search ranking error:', error);
      return { products: [], total: 0 };
    }
  }

  let query = supabase
    .from('products')
    .select(CHAT_PRODUCT_PROJECTION)
    .eq('merchant_id', OGABASSEY_MERCHANT_ID)
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
    return { products: [], total: 0 };
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
  const supabase = createChatToolSupabaseClient();

  try {
    const { data, error } = await supabase
      .from('products')
      .select(CHAT_PRODUCT_PROJECTION)
      .eq('id', params.productId)
      .eq('merchant_id', OGABASSEY_MERCHANT_ID)
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
// CREATE VIRTUAL ACCOUNT
// ============================================

interface VirtualAccountResult {
  success: boolean;
  orderId?: string;
  accountNumber?: string;
  bankName?: string;
  accountName?: string;
  amount?: number;
  expiresAt?: string;
  error?: string;
}

export async function handleCreateVirtualAccount(
  params: CreateVirtualAccountParams,
  sessionId: string
): Promise<VirtualAccountResult> {
  const supabase = createChatToolSupabaseClient(sessionId);

  try {
    // 1. Create the chat order first
    const subtotal = params.items.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );

    const { data: order, error: orderError } = await supabase
      .from('chat_orders')
      .insert({
        merchant_id: OGABASSEY_MERCHANT_ID,
        session_id: sessionId,
        customer_email: params.customerEmail,
        customer_name: params.customerName,
        customer_phone: params.customerPhone || null,
        items: params.items,
        subtotal: subtotal,
        status: 'pending_payment',
      })
      .select('id')
      .single();

    if (orderError || !order) {
      console.error('[Chat Tools] Order creation error:', orderError);
      return { success: false, error: 'Failed to create order' };
    }

    // Virtual account generation via Kuda API is not yet integrated.
    // Block this flow to prevent customers from sending money to fake accounts.
    // TODO: Replace with an actual Kuda virtual-account API call when ready.
    console.warn(
      '[Chat Tools] Virtual account creation blocked — Kuda API not integrated. Order:',
      order.id
    );
    return {
      success: false,
      orderId: order.id,
      error:
        'Bank transfer payment is temporarily unavailable. Please use card payment at checkout or contact support.',
    };
  } catch (err) {
    console.error('[Chat Tools] Virtual account error:', err);
    return { success: false, error: 'Failed to generate payment account' };
  }
}

// ============================================
// CHECK PAYMENT STATUS
// ============================================

interface PaymentStatusResult {
  status: 'pending' | 'paid' | 'expired' | 'not_found';
  orderId?: string;
  paidAt?: string;
  amount?: number;
  accountNumber?: string;
  bankName?: string;
}

function getMetadataString(
  metadata: Record<string, unknown> | null,
  key: 'account_number' | 'bank_name'
): string | null {
  const value = metadata?.[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export async function handleCheckPaymentStatus(
  params: CheckPaymentStatusParams,
  sessionId: string
): Promise<PaymentStatusResult> {
  const supabase = createChatToolSupabaseClient(sessionId);

  try {
    let order: {
      id: string;
      status: string;
      paid_at: string | null;
      created_at: string;
      subtotal: number;
      virtual_account_number: string | null;
      virtual_account_bank: string | null;
      metadata: Record<string, unknown> | null;
    } | null = null;

    // Try to find order by orderId first, then by email
    if (params.orderId) {
      const { data } = await supabase
        .from('chat_orders')
        .select(
          'id, status, paid_at, created_at, subtotal, virtual_account_number, virtual_account_bank, metadata'
        )
        .eq('id', params.orderId)
        .eq('merchant_id', OGABASSEY_MERCHANT_ID)
        .eq('session_id', sessionId)
        .maybeSingle();

      if (data) {
        order = data;
      }
    }

    // If no orderId or not found, try by email (most recent)
    if (!order && params.customerEmail) {
      const { data } = await supabase
        .from('chat_orders')
        .select(
          'id, status, paid_at, created_at, subtotal, virtual_account_number, virtual_account_bank, metadata'
        )
        .eq('customer_email', params.customerEmail)
        .eq('merchant_id', OGABASSEY_MERCHANT_ID)
        .eq('session_id', sessionId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (data) {
        order = data;
      }
    }

    if (!order) {
      return { status: 'not_found' };
    }

    const accountNumber =
      order.virtual_account_number ||
      getMetadataString(order.metadata, 'account_number');
    const bankName =
      order.virtual_account_bank ||
      getMetadataString(order.metadata, 'bank_name');

    if (order.status === 'paid') {
      return {
        status: 'paid',
        orderId: order.id,
        paidAt: order.paid_at || undefined,
        amount: order.subtotal,
      };
    }

    // Check if expired (30 min from creation)
    const createdAt = new Date(order.created_at);
    const expiresAt = new Date(createdAt.getTime() + 30 * 60 * 1000);

    if (new Date() > expiresAt) {
      return { status: 'expired', orderId: order.id };
    }

    return {
      status: 'pending',
      orderId: order.id,
      amount: order.subtotal,
      accountNumber: accountNumber || undefined,
      bankName: bankName || undefined,
    };
  } catch (err) {
    console.error('[Chat Tools] Payment status error:', err);
    return { status: 'not_found' };
  }
}

// ============================================
// GET RECOMMENDATIONS
// ============================================

export async function handleGetRecommendations(
  params: GetRecommendationsParams
): Promise<ChatProductResult[]> {
  const supabase = createChatToolSupabaseClient();

  try {
    // First get the source product
    const { data: sourceProduct, error: sourceError } = await supabase
      .from('products')
      .select('id, name, price, category, brand')
      .eq('id', params.productId)
      .eq('merchant_id', OGABASSEY_MERCHANT_ID)
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
      .eq('merchant_id', OGABASSEY_MERCHANT_ID)
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

// ============================================
// ADD TO CART (Returns product for frontend)
// ============================================

export function handleAddToCart(
  params: AddToCartParams
): Promise<ChatProductResult | null> {
  // Just return the product details - actual cart management happens on frontend
  return handleGetProductDetails({ productId: params.productId });
}
