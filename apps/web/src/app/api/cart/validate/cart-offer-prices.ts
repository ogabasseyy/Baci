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
  validationItems: OfferValidationItem[],
  products: readonly { id: string; merchant_id: string }[]
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

  const owners = new Map(
    products.map((product) => [product.id.toLowerCase(), product.merchant_id])
  );
  const groups = new Map<string, string[]>();
  for (const id of offerProductIds) {
    if (!owners.has(id.toLowerCase())) continue; // A missing product remains invalid to the route.
    const merchant = owners.get(id.toLowerCase());
    if (!merchant || !uuidRegex.test(merchant))
      throw new Error('Cannot verify offer merchant');
    const ids = groups.get(merchant) ?? [];
    ids.push(id);
    groups.set(merchant, ids);
  }
  const rows = new Map<string, CartOfferRow>();
  for (const [merchantId, productIds] of groups) {
    const resolutions = await fetchOfferResolutions(callRpc, {
      merchantId,
      productIds,
    });
    for (const resolution of resolutions.values())
      rows.set(
        makeOfferLineKey(resolution.productId, resolution.offerId),
        toCartOfferRow(resolution)
      );
  }
  return rows;
}
