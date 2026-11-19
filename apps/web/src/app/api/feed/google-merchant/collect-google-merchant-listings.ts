import { generateGoogleMerchantFeed } from './feed-builder';
import type {
  FeedMerchant,
  FeedProduct,
  GoogleMerchantListing,
  ImageManifestMap,
} from './feed-types';

/** Keep partner IDs and eligibility aligned with Google's emitted listings. */
export function collectGoogleMerchantListings(
  products: FeedProduct[],
  merchant: FeedMerchant,
  baseUrl: string,
  imageManifest: ImageManifestMap
): GoogleMerchantListing[] {
  const listings: GoogleMerchantListing[] = [];
  generateGoogleMerchantFeed(
    products,
    merchant,
    baseUrl,
    imageManifest,
    (row) => listings.push(row)
  );
  return listings;
}
