export type OrderOfferLine = {
  product_id?: string | null;
  offer_id?: string | null;
};

export type OrderOfferQueryResult = {
  data: { offer_id: string; price?: number | string | null }[] | null;
  error: { message: string } | null;
};

export type LiveOrderOffers = {
  mismatch: OrderOfferLine | null;
  /** `${product_id}::${offer_id}` → live offer price (finite only). */
  prices: Map<string, number>;
};

const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Loads the live offers for every order line naming one, in a single
 * per-product fan-out. Returns the first line whose offer is not live for
 * its own product plus the live price map every offer-aware check shares
 * (assurance fees, negotiation catalog, VAT). Malformed ids fail closed as
 * mismatches (never a 22P02 500 from the offers lookup or the order RPC).
 * Throws the first lookup error for the caller to report as a 500.
 */
export async function fetchLiveOrderOffers(
  fetchOffers: (productId: string) => Promise<OrderOfferQueryResult>,
  items: OrderOfferLine[]
): Promise<LiveOrderOffers> {
  const prices = new Map<string, number>();
  const offerLines = items.filter((item) => item.offer_id);
  if (offerLines.length === 0) return { mismatch: null, prices };

  const malformed = offerLines.find(
    (item) =>
      typeof item.product_id !== 'string' ||
      !uuidRegex.test(item.product_id) ||
      typeof item.offer_id !== 'string' ||
      !uuidRegex.test(item.offer_id)
  );
  if (malformed) return { mismatch: malformed, prices };

  const productIds = Array.from(
    new Set(offerLines.map((item) => String(item.product_id)))
  );
  // Bounded fan-out: a public order can name up to 200 lines, so never run
  // one live lookup per product concurrently — chunk the reads instead.
  const results: {
    productId: string;
    data: OrderOfferQueryResult['data'];
    error: OrderOfferQueryResult['error'];
  }[] = [];
  for (let index = 0; index < productIds.length; index += 10) {
    const chunk = await Promise.all(
      productIds.slice(index, index + 10).map(async (productId) => ({
        productId,
        ...(await fetchOffers(productId)),
      }))
    );
    results.push(...chunk);
  }
  const lookupError = results.find((result) => result.error)?.error;
  if (lookupError) throw new Error(lookupError.message);

  const liveOfferIds = new Set(
    results.flatMap((result) =>
      (result.data ?? []).map((offer) => {
        const key = `${result.productId}::${String(offer.offer_id)}`;
        // Number(null) and Number('') are 0 — an unpriced row must stay out
        // of the map (membership still counts it live) rather than pricing
        // checks at zero.
        if (
          offer.price !== null &&
          offer.price !== undefined &&
          offer.price !== ''
        ) {
          const price = Number(offer.price);
          if (Number.isFinite(price)) prices.set(key, price);
        }
        return key;
      })
    )
  );
  const mismatch =
    offerLines.find(
      (item) => !liveOfferIds.has(`${item.product_id}::${item.offer_id}`)
    ) ?? null;
  return { mismatch, prices };
}

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
  return (await fetchLiveOrderOffers(fetchOffers, items)).mismatch;
}
