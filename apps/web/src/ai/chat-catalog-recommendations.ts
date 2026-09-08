import { getChatCatalogContext } from '@/ai/chat-catalog-context';
import { CHAT_PRODUCT_PROJECTION } from '@/ai/chat-product-projection';
import {
  type ChatProductResult,
  createChatProductResult,
} from '@/ai/chat-product-result';
import type { GetRecommendationsParams } from '@/ai/chat-tools';
export async function handleGetRecommendations(
  params: GetRecommendationsParams
): Promise<ChatProductResult[]> {
  const { supabase, merchantId } = await getChatCatalogContext();

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

// ============================================
// ADD TO CART (Returns product for frontend)
// ============================================
