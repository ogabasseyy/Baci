import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrderOfferQueryResult } from '@/lib/checkout/verify-order-offer-lines';
import type { AgenticCheckoutOrderResult } from './checkout-order-dispatch';
import { prepareAgenticOfferEconomics } from './prepare-agentic-offer-economics';

export type ResolvedAgenticOfferPrices =
  | { ok: true; liveOfferPrices: Map<string, number> }
  | { ok: false; result: AgenticCheckoutOrderResult };

/**
 * Verify exact-offer lines against the live catalog and reconcile their
 * prices, exactly like /api/orders. Bound shared-cart checkouts fall
 * through verification failure with no live prices: a committed order
 * whose retry lands after the offer changed must still reach the
 * binding RPC's replay path, which revalidates authoritatively in SQL.
 */
export async function resolveAgenticOfferPrices(
  supabase: SupabaseClient,
  orderItemsPayload: Parameters<typeof prepareAgenticOfferEconomics>[1],
  sharedCartBinding: unknown
): Promise<ResolvedAgenticOfferPrices> {
  const preparedOffers = await prepareAgenticOfferEconomics(
    (productId) =>
      supabase.rpc('get_product_offers', {
        p_product_id: productId,
      }) as unknown as Promise<OrderOfferQueryResult>,
    orderItemsPayload
  );
  if (!preparedOffers.ok) {
    // A committed bound order must still replay when the offer catalog
    // changed under the retry (exact offer deleted/deactivated after
    // commit, response lost): refusing here would report an invalid
    // offer for a completed checkout without ever reaching the binding
    // RPC's replay path. Fall through with no live prices — the
    // binding path revalidates authoritatively in SQL, so it replays
    // or fails closed there. Mirrors the dispatch's
    // OrderConditionUnavailableError fall-through.
    if (!sharedCartBinding) return preparedOffers;
    return { ok: true, liveOfferPrices: new Map() };
  }
  return preparedOffers;
}
