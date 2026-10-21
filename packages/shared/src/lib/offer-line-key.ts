/**
 * `${productId}::${offerId}` identity key shared by every consumer.
 * UUID hex is case-insensitive but Postgres canonicalizes to lowercase,
 * so both parts are lowercased: map keys built from DB-returned ids and
 * lookups built from caller-supplied ids meet regardless of spelling.
 */
export function makeOfferLineKey(productId: string, offerId: string): string {
  return `${productId.toLowerCase()}::${offerId.toLowerCase()}`;
}
