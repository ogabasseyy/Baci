import { expect, it, vi } from 'vitest';

const context = vi.hoisted(() => vi.fn());
vi.mock('@/ai/chat-catalog-context', () => ({
  getChatCatalogContext: context,
}));

import { handleAddToCart } from './chat-catalog-cart';

it('does not offer a cart confirmation for a product outside the resolved store', async () => {
  // Arrange: only the scoped active-product lookup may authorize a card.
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
  context.mockResolvedValue({
    merchantId: 'current-store',
    supabase: { from: () => query },
  });
  // Act
  const result = await handleAddToCart({
    productId: 'another-store-product',
    quantity: 2,
  });
  // Assert
  expect(result).toBeNull();
  expect(query.eq).toHaveBeenCalledWith('merchant_id', 'current-store');
  expect(query.eq).toHaveBeenCalledWith('id', 'another-store-product');
  expect(query.eq).toHaveBeenCalledWith('status', 'active');
});
