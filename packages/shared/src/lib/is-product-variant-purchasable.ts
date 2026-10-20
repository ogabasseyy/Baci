export interface ProductVariantPurchasabilityLike {
  in_stock?: boolean | null;
  is_purchasable?: boolean;
  stock_quantity?: number | null;
  effective_policy?: string | null;
  inventory_tracking_policy?: string | null;
  available_units?: number | null;
}

export function isProductVariantPurchasable(
  manageStock: boolean | null | undefined,
  variant: ProductVariantPurchasabilityLike
) {
  if (typeof variant.is_purchasable === 'boolean') {
    return variant.is_purchasable;
  }

  // Serialized tracking resolves from exact units (strict) or stays enabled
  // (unlimited), mirroring the web serialized-stock helper; the inherited
  // effective policy governs when present. This must precede the unmanaged
  // shortcut: a strict serialized variant with zero exact units is
  // unpurchasable even on an unmanaged parent, matching order creation
  // (M24), which enforces finite serialized scalars regardless of
  // parent management. Only non-serialized variants reach the
  // scalar/flag logic below.
  const policy = variant.effective_policy ?? variant.inventory_tracking_policy;
  if (policy === 'serialized_then_unlimited') {
    return true;
  }
  if (policy === 'serialized_strict') {
    const units =
      typeof variant.available_units === 'number'
        ? variant.available_units
        : undefined;
    const scalar =
      typeof variant.stock_quantity === 'number'
        ? variant.stock_quantity
        : undefined;
    return (units ?? scalar ?? 0) > 0;
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
