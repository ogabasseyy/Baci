import {
  resolveOfferAllocatableStock,
  toFiniteStockQuantity,
} from '@baci/shared/lib';

export interface SerializedOfferStockLike {
  stock_quantity?: number | string | null;
}

export interface SerializedOfferBaseLike {
  effective_policy?: string | null;
  inventory_tracking_policy?: string | null;
  stock?: number | string | null;
}

/**
 * Effective purchasable stock for a selected condition offer on a simple
 * product. Thin folded-snapshot adapter over the shared offer
 * authority: strict caps the finite advertised offer allocation by the
 * folded base unit count, unlimited binds only the offer scalar (an
 * unbounded allocation returns undefined so callers fall through to
 * their scalar/parent logic), and other policies return undefined so
 * callers apply their scalar/parent logic. A strict selection with no
 * folded unit count resolves zero (fail closed, matching search).
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
  const baseUnits = toFiniteStockQuantity(base.stock);
  return (
    resolveOfferAllocatableStock(offer.stock_quantity, {
      effective_policy: policy,
      inventory_tracking_policy: policy,
      availableUnits: baseUnits,
      parentStock: baseUnits ?? 0,
    }) ?? undefined
  );
}
