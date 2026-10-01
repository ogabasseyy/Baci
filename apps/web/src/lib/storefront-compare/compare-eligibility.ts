import { generateSlug } from '../seo-utils';
import { buildCanonicalBrandCompareSlug } from './compare-slugs';
import type { PriceBandDefinition } from './compare-types';

const MIN_BRAND_COMPARE_PRODUCTS = 3;
const MIN_PRICE_BAND_PRODUCTS = 6;
const MIN_DIFFERENTIATING_SPECS = 3;

interface CompareProductInput {
  slug: string;
  name: string;
  category_slug?: string | null;
  product_key_specs?: Record<string, unknown> | null;
}

interface BrandCompareProductInput {
  slug: string;
  name: string;
  brand?: string | null;
  price: number;
}

interface NormalizedBrand {
  key: string;
  label: string;
}

function normalizeBrand(brand?: string | null): NormalizedBrand | null {
  const label = brand?.trim();

  if (!label) {
    return null;
  }

  const key = generateSlug(label);

  if (!key) {
    return null;
  }

  return { key, label };
}

export function canPublishBrandComparePage(input: {
  categorySlug: string;
  leftBrandActiveCount: number;
  rightBrandActiveCount: number;
  differentiatingSpecCount: number;
}): boolean {
  return (
    input.leftBrandActiveCount >= MIN_BRAND_COMPARE_PRODUCTS &&
    input.rightBrandActiveCount >= MIN_BRAND_COMPARE_PRODUCTS &&
    input.differentiatingSpecCount >= MIN_DIFFERENTIATING_SPECS
  );
}

export function canPublishPriceBandPage(input: {
  categorySlug: string;
  bandSlug: string;
  activeProductCount: number;
  differentiatingSpecCount: number;
}): boolean {
  return (
    input.activeProductCount >= MIN_PRICE_BAND_PRODUCTS &&
    input.differentiatingSpecCount >= MIN_DIFFERENTIATING_SPECS
  );
}

export function canPublishProductComparePage(input: {
  categorySlug: string;
  leftCategorySlug: string;
  rightCategorySlug: string;
  differentiatingSpecCount: number;
}): boolean {
  return (
    input.leftCategorySlug === input.categorySlug &&
    input.rightCategorySlug === input.categorySlug &&
    input.differentiatingSpecCount >= MIN_DIFFERENTIATING_SPECS
  );
}

function normalizeComparableArray(value: unknown[]) {
  return value.map(String).sort((left, right) => left.localeCompare(right));
}

function compareProductKeySpecValues(left: unknown, right: unknown) {
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      JSON.stringify(normalizeComparableArray(left)) !==
      JSON.stringify(normalizeComparableArray(right))
    );
  }

  return left !== right;
}

export function buildProductCompareCandidate(input: {
  categorySlug: string;
  leftProduct: CompareProductInput;
  rightProduct: CompareProductInput;
}) {
  const leftSpecs = input.leftProduct.product_key_specs ?? {};
  const rightSpecs = input.rightProduct.product_key_specs ?? {};
  const overlappingKeys = Array.from(
    new Set([...Object.keys(leftSpecs), ...Object.keys(rightSpecs)])
  ).filter((key) => key in leftSpecs && key in rightSpecs);
  const differentiatingSpecCount = overlappingKeys.filter((key) =>
    compareProductKeySpecValues(leftSpecs[key], rightSpecs[key])
  ).length;

  return {
    leftProduct: input.leftProduct,
    rightProduct: input.rightProduct,
    differentiatingSpecCount,
    isIndexable: canPublishProductComparePage({
      categorySlug: input.categorySlug,
      leftCategorySlug: input.leftProduct.category_slug || '',
      rightCategorySlug: input.rightProduct.category_slug || '',
      differentiatingSpecCount,
    }),
  };
}

export function buildBrandCompareCandidate(input: {
  categorySlug: string;
  products: BrandCompareProductInput[];
}) {
  const brandsByKey = new Map<string, { label: string; count: number }>();

  for (const product of input.products) {
    const normalizedBrand = normalizeBrand(product.brand);

    if (!normalizedBrand) {
      continue;
    }

    const existing = brandsByKey.get(normalizedBrand.key);

    if (existing) {
      existing.count += 1;
      continue;
    }

    brandsByKey.set(normalizedBrand.key, {
      label: normalizedBrand.label,
      count: 1,
    });
  }

  const [leftBrandEntry, rightBrandEntry] = [...brandsByKey.entries()].sort(
    (left, right) =>
      right[1].count - left[1].count || left[0].localeCompare(right[0])
  );

  if (!leftBrandEntry || !rightBrandEntry) {
    return null;
  }

  const differentiatingSpecCount = Math.min(
    leftBrandEntry[1].count + rightBrandEntry[1].count,
    4
  );

  return {
    leftBrand: leftBrandEntry[1].label,
    rightBrand: rightBrandEntry[1].label,
    canonicalSlug: buildCanonicalBrandCompareSlug(
      leftBrandEntry[1].label,
      rightBrandEntry[1].label
    ),
    leftBrandActiveCount: leftBrandEntry[1].count,
    rightBrandActiveCount: rightBrandEntry[1].count,
    differentiatingSpecCount,
    isIndexable: canPublishBrandComparePage({
      categorySlug: input.categorySlug,
      leftBrandActiveCount: leftBrandEntry[1].count,
      rightBrandActiveCount: rightBrandEntry[1].count,
      differentiatingSpecCount,
    }),
  };
}

export function buildPriceBandCandidate(input: {
  categorySlug: string;
  band: PriceBandDefinition;
  products: BrandCompareProductInput[];
}) {
  const bandProducts = input.products.filter(
    (product) =>
      product.price <= input.band.ceiling &&
      (input.band.floor ? product.price > input.band.floor : true)
  );
  const differentiatingSpecCount = Math.min(
    new Set(
      bandProducts
        .map((product) => normalizeBrand(product.brand)?.key)
        .filter((brandKey): brandKey is string => Boolean(brandKey))
    ).size,
    4
  );

  return {
    band: input.band,
    products: bandProducts,
    activeProductCount: bandProducts.length,
    differentiatingSpecCount,
    isIndexable: canPublishPriceBandPage({
      categorySlug: input.categorySlug,
      bandSlug: input.band.slug,
      activeProductCount: bandProducts.length,
      differentiatingSpecCount,
    }),
  };
}
