export type OrderOfferLine = {
  product_id?: string | null;
  offer_id?: string | null;
};

export type OrderOfferQueryResult = {
  data: { offer_id: string }[] | null;
  error: { message: string } | null;
};

const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Finds the first order line whose exact condition offer does not name a
 * live offer of its own product. Malformed ids fail closed as mismatches
 * (never a 22P02 500 from the offers lookup or the order RPC). Throws the
 * first lookup error for the caller to report as a 500.
 */
export async function findMismatchedOrderOffer(
  fetchOffers: (productId: string) => Promise<OrderOfferQueryResult>,
  items: OrderOfferLine[]
): Promise<OrderOfferLine | null> {
  const offerLines = items.filter((item) => item.offer_id);
  if (offerLines.length === 0) return null;

  const malformed = offerLines.find(
    (item) =>
      typeof item.product_id !== 'string' ||
      !uuidRegex.test(item.product_id) ||
      typeof item.offer_id !== 'string' ||
      !uuidRegex.test(item.offer_id)
  );
  if (malformed) return malformed;

  const productIds = Array.from(
    new Set(offerLines.map((item) => String(item.product_id)))
  );
  const results = await Promise.all(
    productIds.map(async (productId) => ({
      productId,
      ...(await fetchOffers(productId)),
    }))
  );
  const lookupError = results.find((result) => result.error)?.error;
  if (lookupError) throw new Error(lookupError.message);

  const liveOfferIds = new Set(
    results.flatMap((result) =>
      (result.data ?? []).map(
        (offer) => `${result.productId}::${String(offer.offer_id)}`
      )
    )
  );
  return (
    offerLines.find(
      (item) => !liveOfferIds.has(`${item.product_id}::${item.offer_id}`)
    ) ?? null
  );
}
