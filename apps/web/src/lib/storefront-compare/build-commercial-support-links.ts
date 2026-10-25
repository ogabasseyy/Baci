import { generateSlug } from '../seo-utils';
import {
  buildBrandCompareCandidate,
  buildPriceBandCandidate,
  buildProductCompareCandidate,
} from './compare-eligibility';
import {
  buildCanonicalBrandCompareSlug,
  buildCanonicalProductCompareSlug,
} from './compare-slugs';
import { getCuratedPriceBands } from './price-band-taxonomy';

export interface CommercialSupportLink {
  href: string;
  label: string;
}

/** Build navigation only after the destination loader confirms public eligibility. */
export function buildPriceBandGuideLink(input: {
  storeUrl: string;
  categorySlug: string;
  priceBandSlug: string;
  isIndexable: boolean;
}): CommercialSupportLink | null {
  const band = getCuratedPriceBands(input.categorySlug).find(
    (entry) => entry.slug === input.priceBandSlug
  );
  if (!input.isIndexable || !band) return null;
  return {
    href: `${input.storeUrl.replace(/\/$/, '')}/${input.categorySlug}/best-under/${band.slug}`,
    label: band.label.replace(/^Best /, 'Compare '),
  };
}

interface CommercialSupportProduct {
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

function findFirstEligibleProductCompare(
  categorySlug: string,
  products: CommercialSupportProduct[]
) {
  for (let leftIndex = 0; leftIndex < products.length - 1; leftIndex += 1) {
    const leftProduct = products[leftIndex];

    for (
      let rightIndex = leftIndex + 1;
      rightIndex < products.length;
      rightIndex += 1
    ) {
      const rightProduct = products[rightIndex];
      const candidate = buildProductCompareCandidate({
        categorySlug,
        leftProduct,
        rightProduct,
      });

      if (candidate.isIndexable) {
        return {
          leftProduct,
          rightProduct,
        };
      }
    }
  }

  return null;
}

function buildFirstEligiblePriceBandLink(input: {
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
}): CommercialSupportLink[] {
  const links: CommercialSupportLink[] = [];
  const firstEligibleProductCompare = findFirstEligibleProductCompare(
    input.categorySlug,
    input.products
  );

  if (firstEligibleProductCompare) {
    links.push({
      href: `${input.storeUrl}/${input.categorySlug}/compare/${buildCanonicalProductCompareSlug(firstEligibleProductCompare.leftProduct.slug, firstEligibleProductCompare.rightProduct.slug)}`,
      label: `${firstEligibleProductCompare.leftProduct.name} vs ${firstEligibleProductCompare.rightProduct.name}`,
    });
  }

  if (input.includeBrandCompareLink ?? true) {
    const brandCandidate = buildBrandCompareCandidate({
      categorySlug: input.categorySlug,
      products: input.products,
    });

    if (brandCandidate?.isIndexable) {
      links.push({
        href: `${input.storeUrl}/${input.categorySlug}/compare/${buildCanonicalBrandCompareSlug(brandCandidate.leftBrand, brandCandidate.rightBrand)}`,
        label: `${brandCandidate.leftBrand} vs ${brandCandidate.rightBrand}`,
      });
    }
  }

  const priceBandLink = buildFirstEligiblePriceBandLink({
    storeUrl: input.storeUrl,
    categorySlug: input.categorySlug,
    products: input.products,
  });

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
    const currentBrandKey = generateSlug(currentProduct.brand || '');

    if (
      brandCandidate?.isIndexable &&
      currentBrandKey &&
      [brandCandidate.leftBrand, brandCandidate.rightBrand]
        .map((brand) => generateSlug(brand))
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
