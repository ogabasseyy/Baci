import { getProductSemanticSupport } from '@/config/product-semantic-support';
import { formatCurrencyCompact } from '@/lib/currency';
import { buildProductCompareCandidate } from '@/lib/storefront-compare/compare-eligibility';
import { buildCanonicalProductCompareSlug } from '@/lib/storefront-compare/compare-slugs';
import { getCuratedPriceBands } from '@/lib/storefront-compare/price-band-taxonomy';
import { buildProductContextParagraphs } from './build-product-context-paragraphs';
import { buildProductGuideLinks } from './build-product-guide-links';
import {
  buildProductHref,
  buildProductSemanticCompareSupport,
} from './build-product-semantic-compare-support';
import { buildProductTrustBullets } from './build-product-trust-bullets';
import type {
  BuildProductSemanticModelInput,
  ProductSemanticCandidate,
  ProductSemanticCard,
  ProductSemanticModel,
  ProductSemanticSection,
} from './product-semantic-types';

function getSupportCopy(categorySlug: string) {
  return getProductSemanticSupport(categorySlug);
}

function toTitleCase(value: string) {
  // Humanize machine values like "open_box" / "like-new" into "Open Box" /
  // "Like New" by splitting on whitespace, underscores, and hyphens.
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function isInStock(product: ProductSemanticCandidate) {
  return product.stock == null || product.stock > 0;
}

function conditionBucketMatches(
  currentProduct: ProductSemanticCandidate,
  candidate: ProductSemanticCandidate
) {
  return (
    (currentProduct.condition ?? '').trim().toLowerCase() ===
    (candidate.condition ?? '').trim().toLowerCase()
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

function buildCardDescription(
  product: ProductSemanticCandidate,
  countryCode?: string | null
) {
  const details = product.condition ? [toTitleCase(product.condition)] : [];
  details.push(formatCurrencyCompact(product.price, countryCode || 'NG'));
  return details.join(' • ');
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
        description: buildCardDescription(product, input.countryCode),
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
  return (left: ProductSemanticCandidate, right: ProductSemanticCandidate) =>
    Number((right.brand ?? '').trim() !== (currentProduct.brand ?? '').trim()) -
      Number(
        (left.brand ?? '').trim() !== (currentProduct.brand ?? '').trim()
      ) ||
    Number(isInStock(right)) - Number(isInStock(left)) ||
    Math.abs(left.price - currentProduct.price) -
      Math.abs(right.price - currentProduct.price) ||
    left.slug.localeCompare(right.slug);
}

function findContainingBand(input: BuildProductSemanticModelInput) {
  return getCuratedPriceBands(input.categorySlug, {
    merchantCurrency: input.merchantCurrency,
  }).find(
    (band) =>
      input.currentProduct.price <= band.ceiling &&
      (band.floor ? input.currentProduct.price > band.floor : true)
  );
}

function buildAlternativesSection(
  input: BuildProductSemanticModelInput,
  approvedCompareSlugs: ReadonlySet<string>
) {
  return buildSection(
    input,
    getSupportCopy(input.categorySlug).alternativesHeading,
    input.inventory
      .filter(
        (product) =>
          product.slug !== input.currentProduct.slug &&
          product.category_slug === input.categorySlug
      )
      .sort(rankAlternatives(input.currentProduct)),
    approvedCompareSlugs
  );
}

function buildSameBrandSection(
  input: BuildProductSemanticModelInput,
  approvedCompareSlugs: ReadonlySet<string>
) {
  const currentBrand = input.currentProduct.brand?.trim();

  if (!currentBrand) {
    return null;
  }

  return buildSection(
    input,
    getSupportCopy(input.categorySlug).sameBrandHeading,
    input.inventory
      .filter(
        (product) =>
          product.slug !== input.currentProduct.slug &&
          product.category_slug === input.categorySlug &&
          product.brand?.trim() === currentBrand
      )
      .sort(rankAlternatives(input.currentProduct)),
    approvedCompareSlugs
  );
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

function buildSamePriceSection(
  input: BuildProductSemanticModelInput,
  approvedCompareSlugs: ReadonlySet<string>
) {
  return buildSection(
    input,
    getSupportCopy(input.categorySlug).samePriceHeading,
    buildSamePriceCandidates(input),
    approvedCompareSlugs
  );
}

export function buildProductSemanticModel(
  input: BuildProductSemanticModelInput
): ProductSemanticModel {
  const {
    approvedCompareSlugs,
    input: normalizedInput,
    supportLinks,
  } = buildProductSemanticCompareSupport(input);

  return {
    contextParagraphs: buildProductContextParagraphs(normalizedInput),
    trustBullets: buildProductTrustBullets(normalizedInput),
    supportLinks,
    guideLinks: buildProductGuideLinks(normalizedInput),
    alternatives: buildAlternativesSection(
      normalizedInput,
      approvedCompareSlugs
    ),
    sameBrand: buildSameBrandSection(normalizedInput, approvedCompareSlugs),
    samePrice: buildSamePriceSection(normalizedInput, approvedCompareSlugs),
  };
}
