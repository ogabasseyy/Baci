import { normalizeCanonicalProductCondition } from '@baci/shared/lib';
import { getStorefrontProductOffersByProductIds } from '@/lib/fetch-storefront-product-offers';
import { createLogger } from '@/lib/logger';
import type { CartItem } from '@/stores/cart-store';

const log = createLogger('cart-reprice-offer-lines');

export type LiveOfferRepriceRow = {
  price: number;
  productId: string;
  condition: string | null;
};

export type LiveOfferRepriceMap = Map<string, LiveOfferRepriceRow>;

/**
 * Distinct product ids behind exact (non-variant) offer lines, for one
 * batched live-offer fetch.
 */
export function collectOfferLineProductIds(items: CartItem[]): string[] {
  return Array.from(
    new Set(
      items
        .filter(
          (item) =>
            !item.variant_id &&
            typeof item.offer_id === 'string' &&
            item.offer_id.length > 0
        )
        .map((item) => item.product_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    )
  );
}

/**
 * Live offer rows for exact offer lines, via the same anon-executable
 * RPC checkout validation reads. A merchant-edited offer price would
 * otherwise sail through repricing undetected and fail at order creation
 * with a total/fee mismatch. Fails open with `failed: true` so callers
 * skip offer lines rather than falling back to base prices, which would
 * corrupt a valid offer price.
 */
export async function fetchLiveOfferRepriceMap(
  offerLineProductIds: string[]
): Promise<{ map: LiveOfferRepriceMap; failed: boolean }> {
  const map: LiveOfferRepriceMap = new Map();
  if (offerLineProductIds.length === 0) {
    return { map, failed: false };
  }
  const offersByProduct =
    await getStorefrontProductOffersByProductIds(offerLineProductIds);
  if (!offersByProduct) {
    log.warn('Reprice offer lookup failed; skipping offer lines');
    return { map, failed: true };
  }
  for (const [productId, offers] of Object.entries(offersByProduct)) {
    for (const offer of offers) {
      if (offer.price != null) {
        map.set(offer.id, {
          price: Number(offer.price),
          productId,
          condition: offer.condition ?? null,
        });
      }
    }
  }
  return { map, failed: false };
}

/**
 * Usable live row for an exact offer line: the row must belong to the
 * line's product, and finite zero is a valid price (product_offers has
 * no positive constraint and checkout accepts nonnegative) — only
 * non-finite and negative rows are unusable.
 */
export function resolveOfferLinePrice(
  item: CartItem,
  offerMap: LiveOfferRepriceMap
): { price: number; condition: string | null } | null {
  if (!item.offer_id) {
    return null;
  }
  const live = offerMap.get(item.offer_id);
  if (
    !live ||
    live.productId !== item.product_id ||
    !Number.isFinite(live.price) ||
    live.price < 0
  ) {
    return null;
  }
  return { price: live.price, condition: live.condition };
}

/**
 * Live condition when the submitted one drifted from the live offer row,
 * else null. Checkout canonically compares the submitted condition and
 * rejects a drifted line as an invalid offer, so the drift must refresh
 * with the price. Lines without a submitted condition skip the check,
 * same as the orders route; empty live conditions cannot reconcile.
 */
export function getDriftedOfferCondition(
  submittedCondition: string | undefined,
  liveCondition: string | null
): string | null {
  if (
    submittedCondition == null ||
    typeof liveCondition !== 'string' ||
    liveCondition === '' ||
    normalizeCanonicalProductCondition(submittedCondition) ===
      normalizeCanonicalProductCondition(liveCondition)
  ) {
    return null;
  }
  return liveCondition;
}

export function pickChangedConditionById(result: {
  changes: { id: string }[];
  conditionById: Record<string, string>;
}): Record<string, string> {
  const changed: Record<string, string> = {};
  for (const change of result.changes) {
    const liveCondition = result.conditionById[change.id];
    if (typeof liveCondition === 'string' && liveCondition !== '') {
      changed[change.id] = liveCondition;
    }
  }
  return changed;
}
