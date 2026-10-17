import { recomputeOfferAssuranceFees } from '@/lib/checkout/recompute-offer-assurance-fees';
import { resolveOrderOfferEconomics } from '@/lib/checkout/resolve-order-offer-economics';
import type { OrderOfferQueryResult } from '@/lib/checkout/verify-order-offer-lines';
import { logger } from '@/lib/logger';
import { sanitizeForLog } from '@/lib/sanitize-core';
import type { AgenticCheckoutOrderResult } from './checkout-order-dispatch';

export type PreparedAgenticOfferEconomics =
  | { ok: true; liveOfferPrices: Map<string, number> }
  | { ok: false; result: AgenticCheckoutOrderResult };

/**
 * Verifies agentic order lines naming a condition offer and prepares the
 * shared live-offer basis before economics run. Offer lines must price
 * and reserve the selected offer (not the parent): reconcile the stored
 * condition exactly like /api/orders, recompute offer-line assurance
 * from the verified live basis (the caller quote may be zero/stale, and
 * no negotiation reduction applies on this path), and hand the live
 * price map to the agentic tax helper so every basis matches the RPC.
 * Returns a ready-made 400/500 dispatch result on failure.
 */
export async function prepareAgenticOfferEconomics(
  fetchOffers: (productId: string) => Promise<OrderOfferQueryResult>,
  orderItemsPayload: Array<{
    product_id?: string;
    offer_id?: string | null;
    condition?: string | null;
    has_assurance?: boolean | null;
    assurance_fee?: number;
    quantity: number;
  }>
): Promise<PreparedAgenticOfferEconomics> {
  const offerEconomics = await resolveOrderOfferEconomics(
    fetchOffers,
    orderItemsPayload
  );
  if (!offerEconomics.ok) {
    if (offerEconomics.reason === 'verification_failed') {
      logger.error({
        error: sanitizeForLog(offerEconomics.error),
        message: 'Agentic checkout offer verification failed',
      });
      return {
        ok: false,
        result: {
          data: { error: 'Unable to verify order offers' },
          error: 'Unable to verify order offers',
          ok: false,
          orderId: undefined,
          status: 500,
          statusText: 'Internal Server Error',
        },
      };
    }
    return {
      ok: false,
      result: {
        data: { error: 'Invalid condition offer for order item' },
        error: 'Invalid condition offer for order item',
        ok: false,
        orderId: undefined,
        status: 400,
        statusText: 'Bad Request',
      },
    };
  }
  recomputeOfferAssuranceFees(
    orderItemsPayload,
    offerEconomics.liveOfferPrices,
    { applied: false, negotiation: null }
  );
  return { ok: true, liveOfferPrices: offerEconomics.liveOfferPrices };
}
