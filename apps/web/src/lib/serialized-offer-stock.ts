export interface SerializedOfferStockLike {
  stock_quantity?: number | string | null;
}

export interface SerializedOfferBaseLike {
  effective_policy?: string | null;
  inventory_tracking_policy?: string | null;
  stock?: number | string | null;
}

function toFiniteStock(
  value: number | string | null | undefined
): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Effective purchasable stock for a selected condition offer on a simple
 * product. Serialized policies fold exact units into product stock at the
 * snapshot layer (strict: units; unlimited: units when positive, else an
 * unbounded sentinel). Only strict caps the finite advertised offer
 * allocation by that base count: the unlimited policy permits sales
 * after serialized inventory is exhausted and order creation binds
 * only the offer allocation, so a dwindling positive unit count must
 * not shrink the offer below its scalar. A null offer quantity
 * inherits the base count under both policies. Other policies return
 * undefined so callers apply their scalar/parent logic.
 */
export function resolveSerializedOfferStock(
  offer: SerializedOfferStockLike,
  base: SerializedOfferBaseLike
): number | undefined {
  const policy = base.effective_policy ?? base.inventory_tracking_policy;
  if (
    policy !== 'serialized_strict' &&
    policy !== 'serialized_then_unlimited'
  ) {
    return undefined;
  }
  const scalar = toFiniteStock(offer.stock_quantity);
  const baseUnits = toFiniteStock(base.stock);
  if (scalar === null) {
    return baseUnits === null ? undefined : Math.max(0, baseUnits);
  }
  if (policy === 'serialized_then_unlimited' || baseUnits === null) {
    return Math.max(0, scalar);
  }
  return Math.min(Math.max(0, scalar), Math.max(0, baseUnits));
}
