import 'server-only';
import {
  type AdvertisedPhoneConstraints,
  type AdvertisedPhonePriceFacts,
  type AdvertisedPhoneProduct,
  projectAdvertisedPhonePrices,
} from './advertised-phone-price-projection';
import { assertPublicListingProductRows } from './assert-public-listing-product-rows';
import { getPublicProductVariantsByProductIds } from './cached-data';

export interface StandardListingProjectionOptions
  extends AdvertisedPhoneConstraints {
  sort?: string;
}

function getRowEffectivePrice(row: Record<string, unknown>): number {
  const advertised = row.advertised_price;
  if (typeof advertised === 'number' && Number.isFinite(advertised)) {
    return advertised;
  }
  const price = row.price;
  if (typeof price === 'number' && Number.isFinite(price)) {
    return price;
  }
  if (typeof price === 'string') {
    const parsed = Number(price.replace(/,/g, '').trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

/** Apply display-only facts after the caller has scoped and bounded listing rows. */
export async function projectStandardListingRows<
  T extends Record<string, unknown>,
>(
  merchantId: string,
  rows: T[],
  constraints: StandardListingProjectionOptions = {}
): Promise<Array<T & AdvertisedPhonePriceFacts>> {
  assertPublicListingProductRows(rows);
  const projected = await projectAdvertisedPhonePrices(
    merchantId,
    rows as Array<T & AdvertisedPhoneProduct>,
    getPublicProductVariantsByProductIds,
    constraints
  );

  let result = [...projected];

  if (
    typeof constraints.minPrice === 'number' ||
    typeof constraints.maxPrice === 'number'
  ) {
    result = result.filter((row) => {
      const price = getRowEffectivePrice(row);
      if (
        typeof constraints.minPrice === 'number' &&
        price < constraints.minPrice
      ) {
        return false;
      }
      if (
        typeof constraints.maxPrice === 'number' &&
        price > constraints.maxPrice
      ) {
        return false;
      }
      return true;
    });
  }

  if (constraints.sort === 'price-asc') {
    result.sort((a, b) => getRowEffectivePrice(a) - getRowEffectivePrice(b));
  } else if (constraints.sort === 'price-desc') {
    result.sort((a, b) => getRowEffectivePrice(b) - getRowEffectivePrice(a));
  }

  return result;
}
