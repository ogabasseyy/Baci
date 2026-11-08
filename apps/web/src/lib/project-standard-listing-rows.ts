import 'server-only';
import {
  type AdvertisedPhoneConstraints,
  projectAdvertisedPhonePrices,
} from './advertised-phone-price-projection';
import { assertPublicListingProductRows } from './assert-public-listing-product-rows';
import { getPublicProductVariantsByProductIds } from './cached-data';

/** Apply display-only facts after the caller has scoped and bounded listing rows. */
export async function projectStandardListingRows<
  T extends Record<string, unknown>,
>(
  merchantId: string,
  rows: T[],
  constraints: AdvertisedPhoneConstraints = {}
): Promise<T[]> {
  assertPublicListingProductRows(rows);
  return await projectAdvertisedPhonePrices(
    merchantId,
    rows,
    getPublicProductVariantsByProductIds,
    constraints
  );
}
