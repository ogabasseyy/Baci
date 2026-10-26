import {
  buildBrandCompareCandidate,
  buildPriceBandCandidate,
  buildProductCompareCandidate,
} from './compare-eligibility';
import {
  buildCanonicalBrandCompareSlug,
  buildCanonicalProductCompareSlug,
} from './compare-slugs';
import { filterProductsByBrandSlugs } from './filter-products-by-brand-slugs';
import { findFirstEligibleProductCompare } from './find-first-eligible-product-compare';
import { normalizeInferredBrands } from './normalize-inferred-brands';
import { getCuratedPriceBands } from './price-band-taxonomy';
import { resolveCanonicalBrandKey } from './resolve-canonical-brand-key';

export interface CommercialSupportLink {
  href: string;
  label: string;
}

export interface CommercialSupportProduct {
  slug: string;
  name: string;
  brand?: string | null;
  price: number;
  category_slug?: string | null;
  product_key_specs?: Record<string, unknown> | null;
}

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

function _buildFirstEligiblePriceBandLink(input: {
  storeUrl: string;
  categorySlug: string;
  products: CommercialSupportProduct[];
}) {
  const candidate = buildCategoryPriceBandCandidates(
    input.categorySlug,
    input.products
  ).find((entry) => entry.isIndexable);

  if (!candidate) {
    return null;
  }

  return {
    href: `${input.storeUrl}/${input.categorySlug}/best-under/${candidate.band.slug}`,
    label: candidate.band.label,
  } satisfies CommercialSupportLink;
}

export function buildCategorySupportLinks(input: {
  storeUrl: string;
  categorySlug: string;
  categoryName: string;
  includeBrandCompareLink?: boolean;
  products: CommercialSupportProduct[];
  inferredBrands?: string[];
  approvedCompareSlugs?: ReadonlySet<string>;
  /** Destination compare inventory; brand/price-band candidates derive from it when supplied. */
  compareProducts?: CommercialSupportProduct[];
  /** Article contexts: compare links require an inferred brand; price bands count only inferred-brand products. */
  requireInferredBrandRelevance?: boolean;
}): CommercialSupportLink[] {
  const links: CommercialSupportLink[] = [];
  const normalizedInferred = normalizeInferredBrands(
    input.categorySlug,
    input.inferredBrands
  );
  const brandRelevanceRequired = input.requireInferredBrandRelevance === true;
  const hasInferredBrand = normalizedInferred.length > 0;
  const firstEligibleProductCompare =
    brandRelevanceRequired && !hasInferredBrand
      ? null
      : findFirstEligibleProductCompare(
          input.categorySlug,
          input.products,
          input.inferredBrands,
          input.approvedCompareSlugs
        );

  if (firstEligibleProductCompare) {
    links.push({
      href: `${input.storeUrl}/${input.categorySlug}/compare/${buildCanonicalProductCompareSlug(firstEligibleProductCompare.leftProduct.slug, firstEligibleProductCompare.rightProduct.slug)}`,
      label: `${firstEligibleProductCompare.leftProduct.name} vs ${firstEligibleProductCompare.rightProduct.name}`,
    });
  }

  if (input.includeBrandCompareLink ?? true) {
    const normalizedInferredBrands = normalizeInferredBrands(
      input.categorySlug,
      input.inferredBrands
    );

    const brandCandidate = buildBrandCompareCandidate({
      categorySlug: input.categorySlug,
      products: input.compareProducts ?? input.products,
    });

    if (brandCandidate?.isIndexable) {
      const leftKey = resolveCanonicalBrandKey(
        input.categorySlug,
        brandCandidate.leftBrand
      );
      const rightKey = resolveCanonicalBrandKey(
        input.categorySlug,
        brandCandidate.rightBrand
      );
      const isRelevant =
        leftKey !== rightKey &&
        (brandRelevanceRequired && !hasInferredBrand
          ? false
          : normalizedInferredBrands.length === 0 ||
            (normalizedInferredBrands.includes(leftKey) &&
              normalizedInferredBrands.includes(rightKey)));

      if (isRelevant) {
        links.push({
          href: `${input.storeUrl}/${input.categorySlug}/compare/${buildCanonicalBrandCompareSlug(brandCandidate.leftBrand, brandCandidate.rightBrand)}`,
          label: `${brandCandidate.leftBrand} vs ${brandCandidate.rightBrand}`,
        });
      }
    }
  }

  // Destination eligibility uses the full pool; relevance only requires
  // the chosen band to contain inferred-brand products.
  const fullPool = input.compareProducts ?? input.products;
  const priceBandLink = (() => {
    if (brandRelevanceRequired && !hasInferredBrand) return null;
    const candidates = buildCategoryPriceBandCandidates(
      input.categorySlug,
      fullPool
    );
    const chosen = candidates.find((candidate) => {
      if (!candidate.isIndexable) return false;
      if (!brandRelevanceRequired) return true;
      const bandProducts = filterProductsByBrandSlugs(
        input.categorySlug,
        candidate.products,
        normalizedInferred
      );
      return bandProducts.length > 0;
    });
    if (!chosen) return null;
    return {
      href: `${input.storeUrl}/${input.categorySlug}/best-under/${chosen.band.slug}`,
      label: chosen.band.label,
    };
  })();

  if (priceBandLink) {
    links.push(priceBandLink);
  }

  return links;
}

export function buildProductSupportLinks(input: {
  approvedCompareSlugs?: ReadonlySet<string>;
  storeUrl: string;
  categorySlug: string;
  currentProductSlug: string;
  currentProductPrice: number;
  includeBrandCompareLink?: boolean;
  products: CommercialSupportProduct[];
  // Optional precomputed (product-invariant) price-band candidates. When a
  // caller fans this function across many products it should pass one shared
  // list instead of rebuilding it per product. Omitted callers keep the old
  // self-computing behavior.
  priceBandCandidates?: PriceBandCandidate[];
}): CommercialSupportLink[] {
  const links: CommercialSupportLink[] = [];
  const currentProduct = input.products.find(
    (product) => product.slug === input.currentProductSlug
  );

  if (!currentProduct) {
    return links;
  }

  const productCompareEntry = input.products
    .filter((product) => product.slug !== input.currentProductSlug)
    .map((alternate) => ({
      alternate,
      candidate: buildProductCompareCandidate({
        categorySlug: input.categorySlug,
        leftProduct: currentProduct,
        rightProduct: alternate,
      }),
    }))
    .find((entry) => {
      if (!entry.candidate.isIndexable) {
        return false;
      }

      const canonicalSlug = buildCanonicalProductCompareSlug(
        currentProduct.slug,
        entry.alternate.slug
      );

      return (
        input.approvedCompareSlugs === undefined ||
        input.approvedCompareSlugs.has(canonicalSlug)
      );
    });

  if (productCompareEntry) {
    links.push({
      href: `${input.storeUrl}/${input.categorySlug}/compare/${buildCanonicalProductCompareSlug(currentProduct.slug, productCompareEntry.alternate.slug)}`,
      label: `Compare with ${productCompareEntry.alternate.name}`,
    });
  }

  if (input.includeBrandCompareLink ?? true) {
    const brandCandidate = buildBrandCompareCandidate({
      categorySlug: input.categorySlug,
      products: input.products,
    });
    const currentBrandKey = resolveCanonicalBrandKey(
      input.categorySlug,
      currentProduct.brand
    );

    if (
      brandCandidate?.isIndexable &&
      currentBrandKey &&
      [brandCandidate.leftBrand, brandCandidate.rightBrand]
        .map((brand) => resolveCanonicalBrandKey(input.categorySlug, brand))
        .includes(currentBrandKey)
    ) {
      links.push({
        href: `${input.storeUrl}/${input.categorySlug}/compare/${buildCanonicalBrandCompareSlug(brandCandidate.leftBrand, brandCandidate.rightBrand)}`,
        label: `${brandCandidate.leftBrand} vs ${brandCandidate.rightBrand}`,
      });
    }
  }

  const priceBandCandidates =
    input.priceBandCandidates ??
    buildCategoryPriceBandCandidates(input.categorySlug, input.products);
  const priceBandCandidate = priceBandCandidates.find(
    (candidate) =>
      candidate.isIndexable &&
      input.currentProductPrice <= candidate.band.ceiling &&
      (candidate.band.floor
        ? input.currentProductPrice > candidate.band.floor
        : true)
  );

  if (priceBandCandidate) {
    links.push({
      href: `${input.storeUrl}/${input.categorySlug}/best-under/${priceBandCandidate.band.slug}`,
      label: priceBandCandidate.band.label,
    });
  }

  return links;
}
