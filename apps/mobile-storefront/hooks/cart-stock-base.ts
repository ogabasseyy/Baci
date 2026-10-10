import { createLogger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';

const log = createLogger('Cart');

/**
 * Base-option stock through the shopper-safe base inventory projection
 * (anchor-first effective policy plus base available units). Unlimited
 * tracking bypasses; strict compares exact units; other policies use
 * the scalar parent stock, mirroring the price-options base branch and
 * the PDP predicate. `strictUnits` carries the shared serialized pool
 * when the policy is strict so the caller can cap the aggregate across
 * the base line and every sibling offer (all claim the same
 * hidden-anchor inventory); it is null otherwise. A product absent from
 * the projection (vanished or unpublished) reports zero; other lookup
 * failures throw so the caller retries instead of overselling.
 */
export async function resolveBaseStock(
  productId: string,
  parentStock: number
): Promise<{ stock: number; strictUnits: number | null }> {
  const { data, error } = await supabase.rpc(
    'get_storefront_product_base_inventory',
    { p_product_ids: [productId] }
  );
  if (error) {
    log.error('Base stock check failed:', error);
    throw new Error('Cannot verify stock availability. Please try again.');
  }
  const row = (Array.isArray(data) ? data : []).find(
    (entry: { product_id?: unknown }) => entry?.product_id === productId
  ) as
    | {
        effective_policy?: unknown;
        available_units?: unknown;
      }
    | undefined;
  if (!row) {
    log.error('Base stock check found no such product:', productId);
    return { stock: 0, strictUnits: null };
  }
  if (row.effective_policy === 'serialized_then_unlimited') {
    return { stock: Number.MAX_SAFE_INTEGER, strictUnits: null };
  }
  if (row.effective_policy === 'serialized_strict') {
    if (
      typeof row.available_units === 'number' &&
      Number.isFinite(row.available_units)
    ) {
      const units = Math.max(0, row.available_units);
      return { stock: units, strictUnits: units };
    }
    log.error('Base stock check found no unit count:', productId);
    throw new Error('Cannot verify stock availability. Please try again.');
  }
  return { stock: parentStock, strictUnits: null };
}
