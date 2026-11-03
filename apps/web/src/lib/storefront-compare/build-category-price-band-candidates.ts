import { isAvailableProduct } from '@/lib/storefront-content/is-available-product';
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

function isProductEligibleForPriceBand(
  product: CommercialSupportProduct
): boolean {
  if (!Number.isFinite(product.price) || product.price <= 0) return false;
  if (product.has_condition_offers) return true;
  return isAvailableProduct(product);
}

export function buildCategoryPriceBandCandidates(
  categorySlug: string,
  products: CommercialSupportProduct[],
  options?: { merchantCurrency?: string | null }
): PriceBandCandidate[] {
  const availableProducts = products.filter(isProductEligibleForPriceBand);
  return getCuratedPriceBands(categorySlug, options).map((band) =>
    buildPriceBandCandidate({ categorySlug, band, products: availableProducts })
  );
}
