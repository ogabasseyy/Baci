export type HandoffVariantRow = {
  effective_policy?: string | null;
  stock_quantity?: number | null;
};

/**
 * PDP parity for one projected variant row: mirrors
 * isPublicVariantPurchasable — a null ordinary quantity inherits the
 * parent's effective stock instead of coercing to zero, so the tool
 * refuses only what the PDP cannot sell. Serialized rows stay exact:
 * their hydrated units decide, never the parent.
 */
export function isVariantRowPurchasable(
  variant: HandoffVariantRow,
  parentStock: number,
  quantity: number
): boolean {
  if (variant.effective_policy === 'serialized_then_unlimited') return true;
  if (
    variant.stock_quantity == null &&
    variant.effective_policy !== 'serialized_strict'
  )
    return parentStock >= quantity;
  return Number(variant.stock_quantity ?? 0) >= quantity;
}
