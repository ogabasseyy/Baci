import { toFiniteOfferPrice } from './to-finite-offer-price';

/**
 * Display price basis for a selected offer: the finite offer price, or
 * the parent price when the snapshot carries none.
 */
export function resolveOfferPriceBasis(
  offerPrice: unknown,
  parentPrice: number
): number {
  return toFiniteOfferPrice(offerPrice) ?? parentPrice;
}
