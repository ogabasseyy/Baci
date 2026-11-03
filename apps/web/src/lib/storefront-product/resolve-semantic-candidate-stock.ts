import { getEffectiveProductStock } from '@baci/shared';

export interface SemanticStockInput {
  manage_stock?: boolean | null;
  stock?: number | null;
  stock_quantity?: number | null;
}

/**
 * Resolves the semantic candidate `stock` value:
 * - `manage_stock === false` or `manage_stock === null`: returns `null`
 *   (unmanaged availability, consistent with the storefront for these two states).
 * - `manage_stock === true` or `manage_stock === undefined` (omitted projection):
 *   returns `getEffectiveProductStock(row)` (finite number; `0` = out of stock)
 *   so an omitted column never silently manufactures availability. This is an
 *   intentional projection-boundary difference: coerceStorefrontManageStock
 *   also treats undefined as unmanaged; this helper does not.
 */
export function resolveSemanticCandidateStock(
  row: SemanticStockInput
): number | null {
  if (row.manage_stock === false || row.manage_stock === null) {
    return null;
  }

  return getEffectiveProductStock(row);
}
