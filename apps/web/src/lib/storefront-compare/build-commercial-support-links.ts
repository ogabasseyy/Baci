import {
  buildCategoryPriceBandCandidates,
  type PriceBandCandidate,
} from './build-category-price-band-candidates';
import {
  buildBrandCompareCandidate,
  buildProductCompareCandidate,
} from './compare-eligibility';
import { buildCanonicalProductCompareSlug } from './compare-slugs';
import { filterProductsByBrandSlugs } from './filter-products-by-brand-slugs';
import { findFirstEligibleProductCompare } from './find-first-eligible-product-compare';
import { normalizeInferredBrands } from './normalize-inferred-brands';
import { resolveCanonicalBrandKey } from './resolve-canonical-brand-key';

export interface CommercialSupportLink {
  href: string;
  label: string;
}

export interface CommercialSupportProduct {
  id?: string | null;
  slug: string;
  name: string;
  brand?: string | null;
  price: number;
  category_slug?: string | null;
  product_key_specs?: Record<string, unknown> | null;
  stock?: number | string | null;
  stock_quantity?: number | string | null;
  manage_stock?: boolean | null;
  has_condition_offers?: boolean | null;
}

export function buildCategorySupportLinks(input: {
  storeUrl: string;
  categorySlug: string;
  categoryName: string;
  includeBrandCompareLink?: boolean;
  products: CommercialSupportProduct[];
  inferredBrands?: string[];
  preferredPriceBandSlugs?: string[];
  approvedCompareSlugs?: ReadonlySet<string>;
  merchantCurrency?: string | null;
  /** Destination compare inventory. Brand candidates derive from it; callers that cannot supply it must pass a pool identical to the destination compare inventory, or those links may point at a candidate the compare page rejects. */
  compareProducts?: CommercialSupportProduct[];
  /** Bounded price-band pool. Callers that separate price bands from brand compare pass the 150-product pool here. */
  priceBandProducts?: CommercialSupportProduct[];
  /** Article contexts: compare links require an inferred brand; price bands count only inferred-brand products. */
  requireInferredBrandRelevance?: boolean;
  /** When true, emits all indexable price-band links (e.g. for discovery/sitemap parity) instead of stopping at the first match. */
  allPriceBands?: boolean;
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
          href: `${input.storeUrl}/${input.categorySlug}/compare/${brandCandidate.canonicalSlug}`,
          label: `${brandCandidate.leftBrand} vs ${brandCandidate.rightBrand}`,
        });
      }
    }
  }

  // Destination eligibility uses the price-band pool (or caller pool); relevance only requires
  // the chosen band to contain inferred-brand products.
  const fullPool = input.priceBandProducts ?? input.products;
  if (!brandRelevanceRequired || hasInferredBrand) {
    const candidates = buildCategoryPriceBandCandidates(
      input.categorySlug,
      fullPool,
      { merchantCurrency: input.merchantCurrency }
    );
    const isEligibleCandidate = (candidate: (typeof candidates)[number]) => {
      if (!candidate.isIndexable) return false;
      if (!brandRelevanceRequired) return true;
      const bandProducts = filterProductsByBrandSlugs(
        input.categorySlug,
        candidate.products,
        normalizedInferred
      );
      return bandProducts.length > 0;
    };

    if (input.allPriceBands) {
      for (const candidate of candidates) {
        if (isEligibleCandidate(candidate)) {
          links.push({
            href: `${input.storeUrl}/${input.categorySlug}/best-under/${candidate.band.slug}`,
            label: candidate.band.label,
          });
        }
      }
    } else {
      const preferredSlugs = new Set(input.preferredPriceBandSlugs ?? []);
      const chosen =
        (preferredSlugs.size > 0
          ? candidates.find(
              (candidate) =>
                preferredSlugs.has(candidate.band.slug) &&
                isEligibleCandidate(candidate)
            )
          : undefined) ?? candidates.find(isEligibleCandidate);
      if (chosen) {
        links.push({
          href: `${input.storeUrl}/${input.categorySlug}/best-under/${chosen.band.slug}`,
          label: chosen.band.label,
        });
      }
    }
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
  merchantCurrency?: string | null;
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
        href: `${input.storeUrl}/${input.categorySlug}/compare/${brandCandidate.canonicalSlug}`,
        label: `${brandCandidate.leftBrand} vs ${brandCandidate.rightBrand}`,
      });
    }
  }

  const priceBandCandidates =
    input.priceBandCandidates ??
    buildCategoryPriceBandCandidates(input.categorySlug, input.products, {
      merchantCurrency: input.merchantCurrency,
    });
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
