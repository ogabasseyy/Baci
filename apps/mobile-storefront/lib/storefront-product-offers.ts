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
    return rows;
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
