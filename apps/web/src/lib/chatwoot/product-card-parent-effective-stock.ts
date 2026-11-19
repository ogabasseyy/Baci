import { numericStock } from './product-card-numeric-stock';

export function parentEffectiveStock(product: Record<string, unknown>): number {
  const quantity = numericStock(product.stock_quantity);
  const legacyStock = numericStock(product.stock);
  if ((quantity ?? 0) <= 0 && (legacyStock ?? 0) > 0) {
    return Math.max(0, Math.trunc(legacyStock ?? 0));
  }
  return Math.max(0, Math.trunc(quantity ?? 0));
}
