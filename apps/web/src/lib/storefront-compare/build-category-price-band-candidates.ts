import type { CommercialSupportProduct } from './build-commercial-support-links';
import { buildPriceBandCandidate } from './compare-eligibility';
import { getCuratedPriceBands } from './price-band-taxonomy';

/**
 * The curated price-band candidate list for a category. It is INVARIANT of the
 * current product (depends only on categorySlug + products), so callers that
 * fan buildProductSupportLinks across many products should build it ONCE and
 * pass it back in via `priceBandCandidates` rather than rebuilding it per
 * product (the discovery fan-out did this up to 150x).
 */
export type PriceBandCandidate = ReturnType<typeof buildPriceBandCandidate>;

export function buildCategoryPriceBandCandidates(
  categorySlug: string,
  products: CommercialSupportProduct[]
): PriceBandCandidate[] {
  return getCuratedPriceBands(categorySlug).map((band) =>
    buildPriceBandCandidate({ categorySlug, band, products })
  );
}
