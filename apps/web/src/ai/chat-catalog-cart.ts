import { handleGetProductDetails } from '@/ai/chat-catalog-details';
import type { ChatProductResult } from '@/ai/chat-product-result';
import type { AddToCartParams } from '@/ai/chat-tools';
export function handleAddToCart(
  params: AddToCartParams
): Promise<ChatProductResult | null> {
  // Just return the product details - actual cart management happens on frontend
  return handleGetProductDetails({ productId: params.productId });
}
