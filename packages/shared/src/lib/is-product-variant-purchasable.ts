export interface ProductVariantPurchasabilityLike {
  in_stock?: boolean | null;
  is_purchasable?: boolean;
  stock_quantity?: number | null;
}

export function isProductVariantPurchasable(
  manageStock: boolean | null | undefined,
  variant: ProductVariantPurchasabilityLike
) {
  if (typeof variant.is_purchasable === 'boolean') {
    return variant.is_purchasable;
  }

  if (manageStock === false) {
    return true;
  }

  if (typeof variant.stock_quantity === 'number') {
    return variant.stock_quantity > 0;
  }

  if (typeof variant.in_stock === 'boolean') {
    return variant.in_stock;
  }

  return true;
}
