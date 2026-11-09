import { getProductSemanticSupport } from '@/config/product-semantic-support';
import { buildProductCompareCandidate } from '@/lib/storefront-compare/compare-eligibility';
import { buildCanonicalProductCompareSlug } from '@/lib/storefront-compare/compare-slugs';
import { getCuratedPriceBands } from '@/lib/storefront-compare/price-band-taxonomy';
import { buildProductCardDescription } from './build-product-card-description';
import { buildProductHref } from './build-product-semantic-compare-support';
import { buildSupplementalSameBrandCandidates } from './build-supplemental-same-brand-candidates';
import type {
  BuildProductSemanticModelInput,
  ProductSemanticCandidate,
  ProductSemanticCard,
  ProductSemanticSection,
} from './product-semantic-types';

function isInStock(product: ProductSemanticCandidate) {
  return (
    product.manage_stock === false || product.stock == null || product.stock > 0
  );
}

function normalizeText(value?: string | null): string {
  return (value ?? '').trim().toLowerCase();
}

function conditionBucketMatches(
  currentProduct: ProductSemanticCandidate,
  candidate: ProductSemanticCandidate
) {
  return (
    normalizeText(currentProduct.condition) ===
    normalizeText(candidate.condition)
  );
}

function countMatchingSpecs(
  currentProduct: ProductSemanticCandidate,
  candidate: ProductSemanticCandidate
) {
  const currentSpecs = currentProduct.product_key_specs ?? {};
  const candidateSpecs = candidate.product_key_specs ?? {};

  return Object.keys(currentSpecs).filter(
    (key) => key in candidateSpecs && currentSpecs[key] === candidateSpecs[key]
  ).length;
}

function buildDirectCompareCta(input: {
  approvedCompareSlugs: ReadonlySet<string>;
  storeUrl: string;
  categorySlug: string;
  currentProduct: ProductSemanticCandidate;
  candidate: ProductSemanticCandidate;
}) {
  const compareSlug = buildCanonicalProductCompareSlug(
    input.currentProduct.slug,
    input.candidate.slug
  );

  // Compare route approval uses this exact curated slug set; other eligible
  // pairs become non-indexable legacy fallbacks.
  if (!input.approvedCompareSlugs.has(compareSlug)) {
    return {};
  }

  const compareCandidate = buildProductCompareCandidate({
    categorySlug: input.categorySlug,
    leftProduct: input.currentProduct,
    rightProduct: input.candidate,
  });

  if (!compareCandidate.isIndexable) {
    return {};
  }

  return {
    secondaryHref: `${input.storeUrl}/${input.categorySlug}/compare/${compareSlug}`,
    secondaryLabel: `Compare with ${input.candidate.name}`,
  };
}

export const MAX_SEMANTIC_SECTION_CARDS = 6;

function buildSectionCards(
  input: BuildProductSemanticModelInput,
  products: ProductSemanticCandidate[],
  approvedCompareSlugs: ReadonlySet<string>
) {
  return products.slice(0, MAX_SEMANTIC_SECTION_CARDS).map(
    (product) =>
      ({
        title: product.name,
        description: buildProductCardDescription({
          candidate: product,
          categorySlug: input.categorySlug,
          currentProduct: input.currentProduct,
          countryCode: input.countryCode,
        }),
        href: buildProductHref(input.storeUrl, product),
        ...buildDirectCompareCta({
          approvedCompareSlugs,
          storeUrl: input.storeUrl,
          categorySlug: input.categorySlug,
          currentProduct: input.currentProduct,
          candidate: product,
        }),
      }) satisfies ProductSemanticCard
  );
}

function buildSection(
  input: BuildProductSemanticModelInput,
  heading: string,
  products: ProductSemanticCandidate[],
  approvedCompareSlugs: ReadonlySet<string>
): ProductSemanticSection | null {
  const cards = buildSectionCards(input, products, approvedCompareSlugs);
  return cards.length > 0 ? { heading, cards } : null;
}

function rankAlternatives(currentProduct: ProductSemanticCandidate) {
  return (left: ProductSemanticCandidate, right: ProductSemanticCandidate) =>
    Number(conditionBucketMatches(currentProduct, right)) -
      Number(conditionBucketMatches(currentProduct, left)) ||
    Number(isInStock(right)) - Number(isInStock(left)) ||
    Math.abs(left.price - currentProduct.price) -
      Math.abs(right.price - currentProduct.price) ||
    countMatchingSpecs(currentProduct, right) -
      countMatchingSpecs(currentProduct, left) ||
    left.slug.localeCompare(right.slug);
}

function rankSamePrice(currentProduct: ProductSemanticCandidate) {
  const currentNormalizedBrand = normalizeText(currentProduct.brand);
  return (left: ProductSemanticCandidate, right: ProductSemanticCandidate) =>
    Number(normalizeText(right.brand) !== currentNormalizedBrand) -
      Number(normalizeText(left.brand) !== currentNormalizedBrand) ||
    Number(isInStock(right)) - Number(isInStock(left)) ||
    Math.abs(left.price - currentProduct.price) -
      Math.abs(right.price - currentProduct.price) ||
    left.slug.localeCompare(right.slug);
}

function findContainingBand(input: BuildProductSemanticModelInput) {
  return getCuratedPriceBands(input.categorySlug, {
    merchantCurrency: input.merchantCurrency,
  }).find(
    (b) =>
      input.currentProduct.price <= b.ceiling &&
      (!b.floor || input.currentProduct.price > b.floor)
  );
}

function buildAlternativesCandidates(input: BuildProductSemanticModelInput) {
  return input.inventory
    .filter(
      (product) =>
        product.slug !== input.currentProduct.slug &&
        product.category_slug === input.categorySlug
    )
    .sort(rankAlternatives(input.currentProduct));
}

function buildSamePriceCandidates(input: BuildProductSemanticModelInput) {
  const sameCategoryProducts = input.inventory.filter(
    (product) =>
      product.slug !== input.currentProduct.slug &&
      product.category_slug === input.categorySlug
  );
  const containingBand = findContainingBand(input);
  const sameBandProducts = containingBand
    ? sameCategoryProducts.filter(
        (product) =>
          product.price <= containingBand.ceiling &&
          (containingBand.floor ? product.price > containingBand.floor : true)
      )
    : [];
  const selectedPool =
    sameBandProducts.length > 0
      ? sameBandProducts
      : sameCategoryProducts.filter(
          (product) =>
            Math.abs(product.price - input.currentProduct.price) <=
            input.currentProduct.price * 0.2
        );

  return selectedPool.sort(rankSamePrice(input.currentProduct));
}

function selectSectionCards(
  products: ProductSemanticCandidate[],
  seenSlugs: Set<string>,
  excludeSlugs?: ReadonlySet<string>
) {
  const selected: ProductSemanticCandidate[] = [];
  for (const product of products) {
    if (seenSlugs.has(product.slug) || excludeSlugs?.has(product.slug)) {
      continue;
    }
    selected.push(product);
    seenSlugs.add(product.slug);
    if (selected.length === MAX_SEMANTIC_SECTION_CARDS) {
      break;
    }
  }
  return selected;
}

export function buildRecommendationSections(
  normalizedInput: BuildProductSemanticModelInput,
  approvedCompareSlugs: ReadonlySet<string>
) {
  const seenSlugs = new Set<string>([normalizedInput.currentProduct.slug]);
  const currentBrand = normalizedInput.currentProduct.brand?.trim();
  const normalizedCurrentBrand = normalizeText(currentBrand);
  const allAlternatives = buildAlternativesCandidates(normalizedInput);
  const inventorySameBrand = currentBrand
    ? allAlternatives.filter(
        (p) => normalizeText(p.brand) === normalizedCurrentBrand
      )
    : [];
  const sameBrandPool = currentBrand
    ? [
        ...inventorySameBrand,
        ...buildSupplementalSameBrandCandidates(
          normalizedInput,
          normalizedCurrentBrand,
          new Set(allAlternatives.map((p) => p.slug))
        ),
      ].sort(rankAlternatives(normalizedInput.currentProduct))
    : [];
  const nonSameBrandAlternatives = currentBrand
    ? allAlternatives.filter(
        (p) => normalizeText(p.brand) !== normalizedCurrentBrand
      )
    : allAlternatives;

  const samePricePool = buildSamePriceCandidates(normalizedInput);
  const nonSameBrandSamePrice = samePricePool.filter(
    (p) =>
      (!currentBrand || normalizeText(p.brand) !== normalizedCurrentBrand) &&
      conditionBucketMatches(normalizedInput.currentProduct, p)
  );
  const reservedSpecialistSlugs = new Set<string>(
    nonSameBrandAlternatives.length >= 1 && inventorySameBrand.length >= 1
      ? inventorySameBrand
          .slice(0, Math.min(2, inventorySameBrand.length))
          .map((p) => p.slug)
      : []
  );
  if (
    currentBrand &&
    sameBrandPool.length >= 1 &&
    nonSameBrandAlternatives.length >= 2 &&
    nonSameBrandSamePrice.length >= 1
  ) {
    reservedSpecialistSlugs.add(nonSameBrandSamePrice[0].slug);
  }

  const supportCopy = getProductSemanticSupport(normalizedInput.categorySlug);
  const selectedAlternatives = selectSectionCards(
    allAlternatives,
    seenSlugs,
    reservedSpecialistSlugs
  );
  const alternatives = buildSection(
    normalizedInput,
    supportCopy.alternativesHeading,
    selectedAlternatives,
    approvedCompareSlugs
  );

  const selectedSameBrand = currentBrand
    ? selectSectionCards(sameBrandPool, seenSlugs)
    : [];
  const sameBrand = currentBrand
    ? buildSection(
        normalizedInput,
        supportCopy.sameBrandHeading,
        selectedSameBrand,
        approvedCompareSlugs
      )
    : null;

  const selectedSamePrice = selectSectionCards(samePricePool, seenSlugs);
  const samePrice = buildSection(
    normalizedInput,
    supportCopy.samePriceHeading,
    selectedSamePrice,
    approvedCompareSlugs
  );

  return { alternatives, sameBrand, samePrice };
}
