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

export interface CartPriceChange {
  id: string;
  name: string;
  oldPrice: number;
  newPrice: number;
}

export interface CartUnavailableLine {
  id: string;
  name: string;
}

export interface CartConditionChange {
  id: string;
  name: string;
  oldCondition: string;
  newCondition: string;
}

export interface CartOfferAdoption {
  id: string;
  name: string;
  offerId: string;
}

/**
 * Live prices for ONLY the lines that drifted beyond tolerance (`changes`).
 * `priceById` includes every resolved line, so applying it wholesale could
 * clear negotiations on tolerated/unchanged lines — callers that react to a
 * drift should apply just these.
 */
export function pickChangedPriceById(result: {
  changes: { id: string }[];
  priceById: Record<string, number>;
}): Record<string, number> {
  const changed: Record<string, number> = {};
  for (const change of result.changes) {
    const livePrice = result.priceById[change.id];
    if (typeof livePrice === 'number') {
      changed[change.id] = livePrice;
    }
  }
  return changed;
}

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
 * Distinct product ids behind legacy offerless lines that may need offer
 * resolution: non-variant lines without an exact offer id on products
 * flagged with condition offers. The live-offer fetch must cover these
 * products so the caller can adopt an unambiguous offer (or mark the
 * line unavailable) instead of repricing it to the parent price.
 */
export function collectLegacyOfferLineProductIds(
  items: CartItem[],
  offerProductIds: ReadonlySet<string>
): string[] {
  return Array.from(
    new Set(
      items
        .filter(
          (item) =>
            !item.variant_id &&
            !(typeof item.offer_id === 'string' && item.offer_id.length > 0) &&
            typeof item.product_id === 'string' &&
            offerProductIds.has(item.product_id)
        )
        .map((item) => item.product_id as string)
    )
  );
}

/**
 * True when an offerless line is parent-priced (not a legacy offer line):
 * no stored condition, or a condition canonically equal to the parent's.
 * The order RPC prices every offerless non-variant line from
 * `products.price`, so these lines reprice through the normal base path
 * even on products that also carry condition offers. A missing parent
 * condition defaults to 'new', matching the products.condition default.
 */
export function isParentPricedOfferlessLine(
  item: Pick<CartItem, 'condition'>,
  parentCondition: string | null | undefined
): boolean {
  if (item.condition == null || item.condition === '') {
    return true;
  }
  return (
    normalizeCanonicalProductCondition(item.condition) ===
    normalizeCanonicalProductCondition(parentCondition ?? 'new')
  );
}

/**
 * Unambiguous live offer for a legacy offerless line, matched by
 * canonical condition within the line's product. Returns null when no
 * live offer (or more than one) matches: the caller must mark the line
 * unavailable rather than guess, since checkout prices offerless lines
 * from the parent and would reject a wrongly adopted basis.
 */
export function resolveLegacyOfferId(
  item: CartItem,
  offerMap: LiveOfferRepriceMap
): string | null {
  if (item.condition == null || item.condition === '') {
    return null;
  }
  const wanted = normalizeCanonicalProductCondition(item.condition);
  if (wanted === '') {
    return null;
  }
  let match: string | null = null;
  for (const [offerId, row] of offerMap) {
    if (row.productId !== item.product_id) {
      continue;
    }
    if (
      row.condition == null ||
      normalizeCanonicalProductCondition(row.condition) !== wanted
    ) {
      continue;
    }
    if (match !== null) {
      return null;
    }
    match = offerId;
  }
  return match;
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
  conditionChanges?: { id: string }[];
  conditionById: Record<string, string>;
}): Record<string, string> {
  const changed: Record<string, string> = {};
  // Condition-only refreshes reconcile too: they no longer ride along on
  // price changes, so union both change lists.
  for (const change of [
    ...result.changes,
    ...(result.conditionChanges ?? []),
  ]) {
    const liveCondition = result.conditionById[change.id];
    if (typeof liveCondition === 'string' && liveCondition !== '') {
      changed[change.id] = liveCondition;
    }
  }
  return changed;
}

/**
 * Adopted offer ids for legacy lines, keyed by cart line id. Adoptions
 * apply even without a price/condition drift: an unadopted legacy line
 * carries no exact id, so checkout would price it from the parent and
 * reject the cart.
 */
export function pickChangedOfferIdById(result: {
  adoptions?: { id: string }[];
  offerIdById: Record<string, string>;
}): Record<string, string> {
  const changed: Record<string, string> = {};
  for (const adoption of result.adoptions ?? []) {
    const offerId = result.offerIdById[adoption.id];
    if (typeof offerId === 'string' && offerId !== '') {
      changed[adoption.id] = offerId;
    }
  }
  return changed;
}

// Mirror the RPC's ±1 NGN parity tolerance so display rounding is not treated
// as a price change.
const PRICE_TOLERANCE = 1;

// Mirror roundToCents in the order validators: checkout compares EXTENDED
// line totals, so drift detection must use the same line basis.
function roundToCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function hasLinePriceDrift(
  liveUnitPrice: number,
  cartUnitPrice: number,
  quantity: number
): boolean {
  const units =
    Number.isFinite(quantity) && quantity > 0 ? Math.floor(quantity) : 1;
  return (
    Math.abs(
      roundToCents(liveUnitPrice * units) - roundToCents(cartUnitPrice * units)
    ) > PRICE_TOLERANCE
  );
}
