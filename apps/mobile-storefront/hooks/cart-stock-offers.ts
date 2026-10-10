import { createLogger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';

const log = createLogger('Cart');

/**
 * Offer stock through the anon-executable get_product_offers RPC (active
 * offers only) combined with the shopper-safe base inventory
 * projection. A finite offer quantity is capped by strict serialized
 * units (effective minimum, mirroring the price-options offer branch
 * and the PDP predicate); a null one inherits the base effective
 * stock, and unlimited tracking bypasses the unit cap. `strictUnits`
 * carries the shared serialized pool when the base policy is strict so
 * the caller can cap the aggregate across the base line and every
 * sibling offer (all claim the same hidden-anchor inventory); it is
 * null otherwise. An offer missing from the projection (vanished,
 * inactive, or unlisted) reports zero; other lookup failures throw so
 * the caller retries instead of overselling.
 */
export async function resolveOfferStock(
  productId: string,
  offerId: string,
  parentStock: number
): Promise<{ stock: number; strictUnits: number | null }> {
  const [{ data, error }, baseInventory] = await Promise.all([
    supabase.rpc('get_product_offers', {
      p_product_id: productId,
    }),
    supabase.rpc('get_storefront_product_base_inventory', {
      p_product_ids: [productId],
    }),
  ]);
  if (error) {
    log.error('Offer stock check failed:', error);
    throw new Error('Cannot verify stock availability. Please try again.');
  }
  const row = (Array.isArray(data) ? data : []).find(
    (entry: { offer_id?: unknown }) => String(entry?.offer_id ?? '') === offerId
  ) as { stock_quantity?: unknown } | undefined;
  if (!row) {
    log.error('Offer stock check found no such offer:', offerId);
    return { stock: 0, strictUnits: null };
  }
  if (baseInventory.error) {
    log.error('Offer base inventory check failed:', baseInventory.error);
    throw new Error('Cannot verify stock availability. Please try again.');
  }
  const baseRow = (
    Array.isArray(baseInventory.data) ? baseInventory.data : []
  ).find(
    (entry: { product_id?: unknown }) => entry?.product_id === productId
  ) as { effective_policy?: unknown; available_units?: unknown } | undefined;
  if (!baseRow) {
    log.error('Offer stock check found no such product:', productId);
    return { stock: 0, strictUnits: null };
  }
  const offerScalar =
    typeof row.stock_quantity === 'number' &&
    Number.isFinite(row.stock_quantity)
      ? row.stock_quantity
      : null;
  if (baseRow.effective_policy === 'serialized_strict') {
    if (
      typeof baseRow.available_units !== 'number' ||
      !Number.isFinite(baseRow.available_units)
    ) {
      log.error('Offer stock check found no unit count:', offerId);
      throw new Error('Cannot verify stock availability. Please try again.');
    }
    const units = Math.max(0, baseRow.available_units);
    return { stock: Math.min(offerScalar ?? units, units), strictUnits: units };
  }
  if (baseRow.effective_policy === 'serialized_then_unlimited') {
    return { stock: offerScalar ?? Number.MAX_SAFE_INTEGER, strictUnits: null };
  }
  return { stock: offerScalar ?? parentStock, strictUnits: null };
}
