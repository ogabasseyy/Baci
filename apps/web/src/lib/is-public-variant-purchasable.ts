/** Evaluate hydrated public units before applying the parent stock policy. */
export function isPublicVariantPurchasable(
  parent: { manage_stock?: boolean | null },
  variant: {
    inventory_tracking_policy?: string | null;
    stock_quantity?: number | null;
  }
): boolean {
  if (variant.inventory_tracking_policy === 'serialized_strict') {
    return (variant.stock_quantity ?? 0) > 0;
  }
  if (variant.inventory_tracking_policy === 'serialized_then_unlimited') {
    return true;
  }
  return parent.manage_stock !== true || (variant.stock_quantity ?? 0) > 0;
}
