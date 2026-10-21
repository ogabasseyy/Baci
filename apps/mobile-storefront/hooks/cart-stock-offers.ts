import { buildOfferResolutionMap, makeOfferLineKey } from '@baci/shared/lib';
import { createLogger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';

const log = createLogger('Cart');

/**
 * Offer stock through the single offer-resolution authority
 * (anon-executable, active offers only). The allocatable stock arrives
 * policy-capped and parent-inherited from SQL — exactly what checkout
 * enforces — so no per-layer rule restatement remains here.
 * `strictUnits` carries the shared serialized pool when the base
 * policy is strict so the caller can cap the aggregate across the base
 * line and every sibling offer (all claim the same hidden-anchor
 * inventory); it is null otherwise. An offer missing from the
 * projection (vanished, inactive, or unlisted) reports zero; lookup
 * failures throw so the caller retries instead of overselling.
 */
export async function resolveOfferStock(
  productId: string,
  offerId: string
): Promise<{ stock: number; strictUnits: number | null }> {
  const { data, error } = await supabase.rpc(
    'get_storefront_offer_resolution',
    {
      p_merchant_id: null,
      p_product_ids: [productId],
    }
  );
  if (error) {
    log.error('Offer stock check failed:', error);
    throw new Error('Cannot verify stock availability. Please try again.');
  }
  const resolution = buildOfferResolutionMap(data).get(
    makeOfferLineKey(productId, offerId)
  );
  if (!resolution) {
    log.error('Offer stock check found no such offer:', offerId);
    return { stock: 0, strictUnits: null };
  }
  // The authority withholds gated-out rows; a partial projection that
  // still carries one must never read as available (checkout rejects
  // ineligible parents, so reporting stock here would oversell).
  if (!resolution.parentEligible) {
    return { stock: 0, strictUnits: null };
  }
  if (resolution.effectivePolicy === 'serialized_strict') {
    // A strict row with no unit count is a serialized-projection
    // outage, not a genuine sell-out (live SQL coalesces genuine
    // sell-outs to 0): throw retryable like the RPC-error branch so
    // the caller retries instead of reporting sold-out.
    if (
      resolution.availableUnits === null ||
      resolution.allocatableStock === null
    ) {
      log.error('Strict offer stock arrived with no unit count:', {
        productId,
        offerId,
      });
      throw new Error('Cannot verify stock availability. Please try again.');
    }
    const units = resolution.availableUnits;
    return {
      stock: resolution.allocatableStock,
      strictUnits: units,
    };
  }
  // Null is unbounded only for serialized_then_unlimited (the SQL
  // legacy arm always coalesces to the parent stock): any other
  // policy with a missing allocation fails closed at zero.
  if (resolution.allocatableStock === null) {
    return {
      stock:
        resolution.effectivePolicy === 'serialized_then_unlimited'
          ? Number.MAX_SAFE_INTEGER
          : 0,
      strictUnits: null,
    };
  }
  return { stock: resolution.allocatableStock, strictUnits: null };
}
