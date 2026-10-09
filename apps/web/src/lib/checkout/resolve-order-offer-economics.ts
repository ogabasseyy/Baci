import { normalizeCanonicalProductCondition } from '@baci/shared/lib';
import {
  fetchLiveOrderOffers,
  type OrderOfferQueryResult,
} from './verify-order-offer-lines';

export type ResolvableOrderOfferLine = {
  product_id?: string | null;
  offer_id?: string | null;
  condition?: string | null;
};

export type ResolvedOrderOfferEconomics =
  | {
      ok: true;
      liveOfferPrices: Map<string, number>;
      liveOfferConditions: Map<string, string>;
    }
  | { ok: false; reason: 'invalid_offer' }
  | { ok: false; reason: 'verification_failed'; error: unknown };

/**
 * Verifies every order line naming a condition offer against the live
 * catalog and reconciles the stored condition with the reserved offer.
 * Two offers can share one condition, so the stored id is the only thing
 * distinguishing them at fulfillment time; a refurbished offer line
 * carrying condition 'new' would reserve and charge the offer but tell
 * fulfillment another condition. Canonical-compare (callers send canonical
 * spellings, rows store merchant ones), reject mismatches, and persist
 * the live condition otherwise so the stored line always matches the
 * priced offer exactly.
 */
export async function resolveOrderOfferEconomics(
  fetchOffers: (productId: string) => Promise<OrderOfferQueryResult>,
  items: ResolvableOrderOfferLine[]
): Promise<ResolvedOrderOfferEconomics> {
  if (!items.some((item) => item.offer_id)) {
    return {
      ok: true,
      liveOfferPrices: new Map(),
      liveOfferConditions: new Map(),
    };
  }
  let liveOffers: Awaited<ReturnType<typeof fetchLiveOrderOffers>>;
  try {
    liveOffers = await fetchLiveOrderOffers(fetchOffers, items);
  } catch (error) {
    return { ok: false, reason: 'verification_failed', error };
  }
  if (liveOffers.mismatch) return { ok: false, reason: 'invalid_offer' };
  for (const item of items) {
    if (!item.offer_id) continue;
    const liveCondition = liveOffers.conditions.get(
      `${item.product_id}::${item.offer_id}`
    );
    // A live row without a condition cannot bind fulfillment: reject
    // rather than persist an unverified caller label.
    if (liveCondition === undefined)
      return { ok: false, reason: 'invalid_offer' };
    if (
      item.condition != null &&
      normalizeCanonicalProductCondition(item.condition) !==
        normalizeCanonicalProductCondition(liveCondition)
    )
      return { ok: false, reason: 'invalid_offer' };
    item.condition = liveCondition;
  }
  return {
    ok: true,
    liveOfferPrices: liveOffers.prices,
    liveOfferConditions: liveOffers.conditions,
  };
}
