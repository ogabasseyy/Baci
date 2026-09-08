import { getChatCatalogContext } from '@/ai/chat-catalog-context';
import { CHAT_PRODUCT_PROJECTION } from '@/ai/chat-product-projection';
import {
  type ChatProductResult,
  createChatProductResult,
} from '@/ai/chat-product-result';
import type { GetProductDetailsParams } from '@/ai/chat-tools';
export async function handleGetProductDetails(
  params: GetProductDetailsParams
): Promise<ChatProductResult | null> {
  const { supabase, merchantId } = await getChatCatalogContext();

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
