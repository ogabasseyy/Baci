import { parentEffectiveStock } from './product-card-parent-effective-stock';

export function isPurchasableProduct(
  product: Record<string, unknown>
): boolean {
  const policy = product.effective_policy ?? product.inventory_tracking_policy;
  if (policy === 'serialized_then_unlimited') return true;
  const stock = parentEffectiveStock(product);
  if (policy === 'serialized_strict')
    return Number.isFinite(stock) && stock > 0;
  const manageStock =
    typeof product.manage_stock === 'boolean' ? product.manage_stock : true;
  return !manageStock || (Number.isFinite(stock) && stock > 0);
}
