import { generateSlug } from '../seo-utils';
import { brandAuthorityTaxonomy } from '../storefront-category/brand-authority-taxonomy';
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

function resolveCanonicalBrandKey(
  categorySlug: string,
  brand: string | null | undefined
): string {
  const raw = (brand ?? '').trim();
  if (!raw) {
    return '';
  }
  const matchingEntry = brandAuthorityTaxonomy
    .getEntries(categorySlug)
    .find((entry) => brandAuthorityTaxonomy.matchesBrand(entry, raw));
  return matchingEntry?.brandKey ?? generateSlug(raw);
}

function normalizeInferredBrands(
  categorySlug: string,
  inferredBrands?: string[]
): string[] {
  return Array.from(
    new Set(
      (inferredBrands ?? [])
        .map((brand) => resolveCanonicalBrandKey(categorySlug, brand))
        .filter(Boolean)
    )
  );
}

function filterProductsByBrandSlugs(
  categorySlug: string,
  products: CommercialSupportProduct[],
  brandSlugs: string[]
): CommercialSupportProduct[] {
  return products.filter((product) => {
    const brandSlug = resolveCanonicalBrandKey(categorySlug, product.brand);
    return Boolean(brandSlug && brandSlugs.includes(brandSlug));
  });
}

function findFirstEligibleProductCompare(
  categorySlug: string,
  products: CommercialSupportProduct[],
  inferredBrands?: string[]
) {
  const normalizedInferredBrands = normalizeInferredBrands(
    categorySlug,
    inferredBrands
  );

  if (normalizedInferredBrands.length > 0) {
    const preferredProducts = filterProductsByBrandSlugs(
      categorySlug,
      products,
      normalizedInferredBrands
    );

    if (preferredProducts.length >= 2) {
      for (
        let leftIndex = 0;
        leftIndex < preferredProducts.length - 1;
        leftIndex += 1
      ) {
        const leftProduct = preferredProducts[leftIndex];
        for (
          let rightIndex = leftIndex + 1;
          rightIndex < preferredProducts.length;
          rightIndex += 1
        ) {
          const rightProduct = preferredProducts[rightIndex];
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
    }

    return null;
  }

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
  inferredBrands?: string[];
}): CommercialSupportLink[] {
  const links: CommercialSupportLink[] = [];
  const firstEligibleProductCompare = findFirstEligibleProductCompare(
    input.categorySlug,
    input.products,
    input.inferredBrands
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

    let brandCandidate = buildBrandCompareCandidate({
      categorySlug: input.categorySlug,
      products: input.products,
    });

    if (normalizedInferredBrands.length >= 2) {
      const preferredProducts = filterProductsByBrandSlugs(
        input.categorySlug,
        input.products,
        normalizedInferredBrands
      );
      const multiBrandCandidate = buildBrandCompareCandidate({
        categorySlug: input.categorySlug,
        products: preferredProducts,
      });
      if (multiBrandCandidate?.isIndexable) {
        brandCandidate = multiBrandCandidate;
      }
    }

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
        normalizedInferredBrands.length === 0 ||
        (normalizedInferredBrands.includes(leftKey) &&
          normalizedInferredBrands.includes(rightKey));

      if (isRelevant) {
        links.push({
          href: `${input.storeUrl}/${input.categorySlug}/compare/${buildCanonicalBrandCompareSlug(brandCandidate.leftBrand, brandCandidate.rightBrand)}`,
          label: `${brandCandidate.leftBrand} vs ${brandCandidate.rightBrand}`,
        });
      }
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
