import {
  fetchOfferResolutions,
  makeOfferLineKey,
  type OfferAuthorityRpcCall,
  type ResolvedOfferResolution,
} from '@baci/shared/lib';

export type CartOfferRow = {
  offer_id: string;
  price: number | string | null;
  condition: string | null;
  stock_quantity?: number | string | null;
  /** M28 parent shape, computed by the SQL authority (never re-derived). */
  parent_eligible?: boolean;
};

export type OfferValidationItem = {
  id: string;
  variantId?: string;
  offerId?: string;
};

const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toCartOfferRow(resolution: ResolvedOfferResolution): CartOfferRow {
  return {
    offer_id: resolution.offerId,
    price: resolution.priceBasis,
    condition: resolution.condition,
    stock_quantity: resolution.allocatableStock,
    parent_eligible: resolution.parentEligible,
  };
}

/**
 * Live condition-offer prices for a cart validation pass, keyed by
 * `${productId}::${offerId}`. Only non-variant lines with a well-formed
 * offer id trigger a fetch (variant lines price from the variant
 * override). Reads the single offer-resolution authority in one batched
 * call; a missing row means the offer is gone. Throws the query error
 * for the caller to report as a 500.
 */
export async function fetchCartOfferPrices(
  callRpc: OfferAuthorityRpcCall,
  validationItems: OfferValidationItem[]
): Promise<Map<string, CartOfferRow>> {
  const offerProductIds = Array.from(
    new Set(
      validationItems
        .filter(
          (item) =>
            !item.variantId &&
            typeof item.offerId === 'string' &&
            uuidRegex.test(item.offerId) &&
            uuidRegex.test(String(item.id))
        )
        .map((item) => String(item.id))
    )
  );

  // Public-catalog intent: unscoped by merchant (see the route) — the
  // authority still gates on published-or-admin merchants.
  const resolutions = await fetchOfferResolutions(callRpc, {
    merchantId: null,
    productIds: offerProductIds,
  });

  const rows = new Map<string, CartOfferRow>();
  for (const resolution of resolutions.values()) {
    rows.set(
      makeOfferLineKey(resolution.productId, resolution.offerId),
      toCartOfferRow(resolution)
    );
  }
  return rows;
}
