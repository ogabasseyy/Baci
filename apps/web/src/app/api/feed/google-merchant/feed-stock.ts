import { getEffectiveStock } from '@/lib/product-stock';
import { UNLIMITED_STOCK_QUANTITY } from './feed-constants';
import type { FeedProduct } from './feed-types';

export function getFeedStockCount(
  product: FeedProduct,
  option?: { stock_quantity?: number | null }
): number {
  if (product.manage_stock !== true) return UNLIMITED_STOCK_QUANTITY;
  if (option)
    return Number.isFinite(option.stock_quantity)
      ? Math.max(0, option.stock_quantity ?? 0)
      : 0;
  return getEffectiveStock(product);
}
