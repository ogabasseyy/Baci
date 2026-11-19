import type { CommercialSupportProduct } from './build-commercial-support-links';
import { buildPriceBandCandidate } from './compare-eligibility';
import {
  isPriceBandCandidateAvailable,
  parseCandidatePrice,
} from './is-price-band-candidate-available';
import { getCuratedPriceBands } from './price-band-taxonomy';

/**
 * The curated price-band candidate list for a category. It is INVARIANT of the
 * current product (depends only on categorySlug + products), so callers that
 * fan buildProductSupportLinks across many products should build it ONCE and
 * pass it back in via `priceBandCandidates` rather than rebuilding it per
 * product (the discovery fan-out did this up to 150x).
 */
export type PriceBandCandidate<
  T extends CommercialSupportProduct = CommercialSupportProduct,
> = ReturnType<typeof buildPriceBandCandidate<T>>;

function isProductEligibleForPriceBand(
  product: CommercialSupportProduct
): boolean {
  const price = parseCandidatePrice(product.price);
  if (!Number.isFinite(price) || price <= 0) return false;
  return isPriceBandCandidateAvailable(product);
}

export function buildCategoryPriceBandCandidates<
  T extends CommercialSupportProduct,
>(
  categorySlug: string,
  products: T[],
  options?: { merchantCurrency?: string | null }
): PriceBandCandidate<T>[] {
  const availableProducts = products.filter(isProductEligibleForPriceBand);
  return getCuratedPriceBands(categorySlug, options).map((band) =>
    buildPriceBandCandidate({ categorySlug, band, products: availableProducts })
  );
}
