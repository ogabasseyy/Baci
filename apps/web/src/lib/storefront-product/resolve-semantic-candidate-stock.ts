import { getEffectiveProductStock } from '@/lib/product-stock';

export interface SemanticStockInput {
  manage_stock?: boolean | null;
  stock?: number | null;
  stock_quantity?: number | null;
}

/**
 * Resolves the semantic candidate `stock` value:
 * - `manage_stock === false`: returns `null` (unmanaged availability,
 *   aligning with the storefront PDP null-policy where only explicit FALSE
 *   bypasses stock checks; see 20261008130001_search_price_options_null_stock_managed.sql).
 * - `manage_stock === true`, `null`, or `undefined` (managed inventory):
 *   returns `getEffectiveProductStock(row)` (finite number; `0` = out of stock).
 */
export function resolveSemanticCandidateStock(
  row: SemanticStockInput
): number | null {
  if (row.manage_stock === false) {
    return null;
  }

  return getEffectiveProductStock(row);
}
