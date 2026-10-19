import { CanonicalOrderSubtotalLoadError } from './canonical-order-subtotal';

type QuoteOfferLine = {
  offer_id?: string | null;
  product_id?: string;
  variant_id?: string | null;
};

/**
 * Offer lines persist the live offer price and condition (the order RPC
 * resolves variant → offer → parent), so the quote must price from the same
 * verified basis or the snapshot binding rejects the order. Variant and
 * offer never coexist on one line.
 */
export function resolveRedvaultQuoteOffer(
  item: QuoteOfferLine,
  maps: {
    /** `${product_id}::${offer_id}` → live offer condition, when verified. */
    offerConditions?: Map<string, string>;
    /** `${product_id}::${offer_id}` → live offer price, when verified. */
    offerPrices?: Map<string, number>;
  }
): { offerCondition: string | undefined; offerPrice: number | undefined } {
  const offerKey =
    !item.variant_id && item.offer_id && item.product_id
      ? `${item.product_id}::${item.offer_id}`
      : null;
  const offerPrice =
    offerKey !== null ? maps.offerPrices?.get(offerKey) : undefined;
  const offerCondition =
    offerKey !== null ? maps.offerConditions?.get(offerKey) : undefined;
  if (
    offerKey !== null &&
    (offerPrice === undefined || offerCondition === undefined)
  )
    throw new CanonicalOrderSubtotalLoadError(
      'Offer line is missing verified live offer economics'
    );
  return { offerCondition, offerPrice };
}
