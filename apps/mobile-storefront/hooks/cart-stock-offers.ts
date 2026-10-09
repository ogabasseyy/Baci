import { createLogger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';

const log = createLogger('Cart');

/**
 * Offer effective stock through the anon-executable get_product_offers
 * RPC (active offers only) combined with the shopper-safe base
 * inventory projection. A finite offer quantity is capped by strict
 * serialized units (effective minimum, mirroring the price-options
 * offer branch and the PDP predicate); a null one inherits the base
 * effective stock, and unlimited tracking bypasses the unit cap. An
 * offer missing from the projection (vanished, inactive, or unlisted)
 * reports zero; other lookup failures throw so the caller retries
 * instead of overselling.
 */
export async function resolveOfferEffectiveStock(
  productId: string,
  offerId: string,
  parentStock: number
): Promise<number> {
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
    return 0;
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
    return 0;
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
    return Math.min(offerScalar ?? units, units);
  }
  if (baseRow.effective_policy === 'serialized_then_unlimited') {
    return offerScalar ?? Number.MAX_SAFE_INTEGER;
  }
  return offerScalar ?? parentStock;
}
