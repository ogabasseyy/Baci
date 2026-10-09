export type CartOfferRow = {
  offer_id: string;
  price: number | string | null;
};

export type OfferValidationItem = {
  id: string;
  variantId?: string;
  offerId?: string;
};

export type OfferQueryResult = {
  data: CartOfferRow[] | null;
  error: { message: string } | null;
};

const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Live condition-offer prices for a cart validation pass, keyed by
 * `${productId}::${offerId}`. Only non-variant lines with a well-formed
 * offer id trigger a fetch (variant lines price from the variant
 * override). The public RPC returns active rows only, so a missing row
 * means the offer is gone. Throws the first query error for the caller
 * to report as a 500.
 */
export async function fetchCartOfferPrices(
  fetchOffers: (productId: string) => Promise<OfferQueryResult>,
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

  const results = await Promise.all(
    offerProductIds.map(async (productId) => {
      const result = await fetchOffers(productId);
      return { productId, ...result };
    })
  );

  const offerError = results.find((result) => result.error)?.error;
  if (offerError) {
    throw new Error(offerError.message);
  }

  return new Map(
    results.flatMap((result) =>
      (result.data || []).map(
        (offer) =>
          [`${result.productId}::${String(offer.offer_id)}`, offer] as const
      )
    )
  );
}
