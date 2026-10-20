/** `${productId}::${offerId}` identity key shared by every consumer. */
export function makeOfferLineKey(productId: string, offerId: string): string {
  return `${productId}::${offerId}`;
}
