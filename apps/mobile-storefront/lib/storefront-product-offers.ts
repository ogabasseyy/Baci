import { getStorefrontProductOffersByProductIds } from './fetch-storefront-product-offers';
import type { ProductRowWithId } from './storefront-product-variants';

export async function hydrateProductRowsWithConditionOffers<
  TRow extends ProductRowWithId,
>(rows: TRow[]) {
  const offersByProductId = await getStorefrontProductOffersByProductIds(
    rows
      .map((row) => row.id)
      .filter((id): id is string => typeof id === 'string')
  );

  if (offersByProductId === null) {
    // Explicit failure marker: without it an exact offer link cannot tell
    // "lookup failed" from "offerless product" and silently drops the
    // requested identity, letting the shopper add a different
    // price/condition than the option they opened.
    return rows.map((row) => ({ ...row, offers_hydration_failed: true }));
  }

  return rows.map((row) => {
    if (typeof row.id !== 'string') {
      return row;
    }

    return {
      ...row,
      offers: offersByProductId[row.id] ?? [],
    };
  });
}
