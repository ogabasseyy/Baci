import { toFiniteStockQuantity } from './to-finite-stock-quantity';

export interface OfferStockBase {
  effective_policy?: string | null;
  inventory_tracking_policy?: string | null;
  /** Strict serialized base units (folded snapshot stock or live units). */
  availableUnits?: number | null;
  /** Effective parent stock (scalar/legacy fallback already applied). */
  parentStock: number;
}

/**
 * Allocatable stock for a snapshot offer row, mirroring the SQL
 * authority: the finite scalar binds everywhere; strict caps it by the
 * base units; a null scalar inherits the parent stock (legacy/strict)
 * and stays unbounded under serialized_then_unlimited. Returns null
 * for unbounded; callers map it to their own sentinel.
 */
export function resolveOfferAllocatableStock(
  offerScalar: unknown,
  base: OfferStockBase
): number | null {
  const scalar = toFiniteStockQuantity(offerScalar);
  const policy = base.effective_policy ?? base.inventory_tracking_policy;
  const parentStock = Math.max(0, Math.floor(base.parentStock));
  if (policy === 'serialized_strict') {
    const units =
      base.availableUnits === null || base.availableUnits === undefined
        ? 0
        : Math.max(0, Math.floor(base.availableUnits));
    return Math.min(scalar === null ? parentStock : scalar, units);
  }
  if (policy === 'serialized_then_unlimited') {
    return scalar;
  }
  return scalar === null ? parentStock : scalar;
}
