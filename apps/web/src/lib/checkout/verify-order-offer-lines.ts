import {
  fetchOfferResolutions,
  makeOfferLineKey,
  type OfferAuthorityRpcCall,
} from '@baci/shared/lib';

export type OrderOfferLine = {
  product_id?: string | null;
  offer_id?: string | null;
};

export type LiveOrderOffers = {
  mismatch: OrderOfferLine | null;
  /** `${product_id}::${offer_id}` → live offer price (finite only). */
  prices: Map<string, number>;
  /** `${product_id}::${offer_id}` → live offer condition (raw spelling). */
  conditions: Map<string, string>;
};

const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Loads the live offers for every order line naming one, in a single
 * batched authority call. Returns the first line whose offer is not
 * live AND parent-eligible for its own product, plus the live price
 * map every offer-aware check shares (assurance fees, negotiation
 * catalog, VAT). Malformed ids fail closed as mismatches (never a
 * 22P02 500 from the offers lookup or the order RPC). Throws lookup
 * errors for the caller to report as a 500.
 */
export async function fetchLiveOrderOffers(
  callRpc: OfferAuthorityRpcCall,
  items: OrderOfferLine[],
  merchantId?: string | null
): Promise<LiveOrderOffers> {
  const prices = new Map<string, number>();
  const conditions = new Map<string, string>();
  const offerLines = items.filter((item) => item.offer_id);
  if (offerLines.length === 0) return { mismatch: null, prices, conditions };

  const malformed = offerLines.find(
    (item) =>
      typeof item.product_id !== 'string' ||
      !uuidRegex.test(item.product_id) ||
      typeof item.offer_id !== 'string' ||
      !uuidRegex.test(item.offer_id)
  );
  if (malformed) return { mismatch: malformed, prices, conditions };
  // A supplied merchant must be a uuid too: otherwise the authority
  // call raises 22P02 and the order misclassifies caller input as a
  // verification failure (500) instead of an invalid offer (400).
  // offerLines is non-empty here, so the first line always exists.
  if (
    merchantId !== undefined &&
    merchantId !== null &&
    !uuidRegex.test(merchantId)
  ) {
    return { mismatch: offerLines[0], prices, conditions };
  }

  const productIds = Array.from(
    new Set(offerLines.map((item) => String(item.product_id)))
  );
  const resolutions = await fetchOfferResolutions(callRpc, {
    merchantId: merchantId ?? null,
    productIds,
  });

  // The authority withholds gated-out rows (an ineligible parent
  // reads like a missing offer); the flag check stays as
  // defense-in-depth so a partial projection can never bind or
  // publish ineligible economics.
  const live = new Map(
    Array.from(resolutions.entries()).filter(
      ([, resolution]) => resolution.parentEligible === true
    )
  );
  for (const resolution of live.values()) {
    const key = makeOfferLineKey(resolution.productId, resolution.offerId);
    if (resolution.priceBasis !== null) prices.set(key, resolution.priceBasis);
    if (resolution.condition !== null)
      conditions.set(key, resolution.condition);
  }
  const mismatch =
    offerLines.find(
      (item) =>
        !live.has(
          makeOfferLineKey(String(item.product_id), String(item.offer_id))
        )
    ) ?? null;
  return { mismatch, prices, conditions };
}

/**
 * Finds the first order line whose exact condition offer does not name a
 * live offer of its own product. Malformed ids fail closed as mismatches
 * (never a 22P02 500 from the offers lookup or the order RPC). Throws
 * lookup errors for the caller to report as a 500.
 */
export async function findMismatchedOrderOffer(
  callRpc: OfferAuthorityRpcCall,
  items: OrderOfferLine[],
  merchantId?: string | null
): Promise<OrderOfferLine | null> {
  return (await fetchLiveOrderOffers(callRpc, items, merchantId)).mismatch;
}
