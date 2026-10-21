import {
  coerceOfferAuthorityRow,
  type ResolvedOfferResolution,
} from './coerce-offer-authority-row';
import { makeOfferLineKey } from './offer-line-key';

/** Authority rows keyed by `productId::offerId`. */
export function buildOfferResolutionMap(
  rows: unknown
): Map<string, ResolvedOfferResolution> {
  const map = new Map<string, ResolvedOfferResolution>();
  if (!Array.isArray(rows)) return map;
  for (const row of rows) {
    const coerced = coerceOfferAuthorityRow(row);
    if (coerced)
      map.set(makeOfferLineKey(coerced.productId, coerced.offerId), coerced);
  }
  return map;
}
