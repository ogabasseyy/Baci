import { resolveStorefrontProductCategoryName } from './storefront-product-category-name';
import { isUnsupportedSpecValue } from './storefront-specs/is-unsupported-spec-value';
import { isAccessoryLikeCategory } from './storefront-specs/spec-accessory-classifier';
import type { ProductSpecFamily } from './storefront-specs/spec-taxonomy';
import {
  getProductSpecFamily,
  isCameraLikeCategory,
} from './storefront-specs/spec-taxonomy';

export type ProductKeySpecCapabilities = {
  has_5g?: boolean;
  has_card_slot?: boolean;
  has_fm_radio?: boolean;
  has_headphone_jack?: boolean;
  has_nfc?: boolean;
  has_ois?: boolean;
  has_reverse_charging?: boolean;
  has_stereo_speakers?: boolean;
  has_wireless_charging?: boolean;
};

export type ProductCategorySource = {
  categories?: { name?: string | null; slug?: string | null } | null;
  category?: string | null;
  category_slug?: string | null;
  product_key_specs?: ProductKeySpecCapabilities | null;
};

const PHONE_TABLET_LAPTOP_CATEGORY_WORDS = new Set([
  'cell',
  'iphone',
  'iphones',
  'laptops',
  'ipad',
  'ipads',
  'laptop',
  'macbook',
  'macbooks',
  'mobile',
  'phone',
  'phones',
  'smartphone',
  'smartphones',
  'tablet',
  'tablets',
  'smartwatch',
  'smartwatches',
  'wearable',
  'wearables',
  'watch',
  'watches',
  'pixel',
]);

function normalizeCategoryName(value: string) {
  return value.trim().toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
}

function isPhoneTabletLaptopCategory(categoryName: string) {
  if (isAccessoryLikeCategory(categoryName)) {
    return false;
  }

  return (
    categoryName.includes('google pixel') ||
    categoryName
      .split(/[^a-z0-9]+/)
      .some((word) => PHONE_TABLET_LAPTOP_CATEGORY_WORDS.has(word))
  );
}

function hasAuthoritativeJoinedCategorySlug(product: ProductCategorySource) {
  const relationSlug = product.categories?.slug?.trim();

  return Boolean(relationSlug && !isUnsupportedSpecValue(relationSlug));
}

export function classifyProductSchemaCategories(
  product: ProductCategorySource
) {
  const preferredCategory = resolveStorefrontProductCategoryName(product);
  const relationSlug = product.categories?.slug?.trim();
  const topLevelSlug = hasAuthoritativeJoinedCategorySlug(product)
    ? undefined
    : product.category_slug?.trim();
  const rawCategoryNames = [
    preferredCategory,
    relationSlug,
    topLevelSlug,
  ].filter((value): value is string => Boolean(value?.trim()));
  const hasAccessoryCategory = rawCategoryNames.some(isAccessoryLikeCategory);
  const categoryNames = rawCategoryNames
    .map(normalizeCategoryName)
    .filter((value, index, values) => values.indexOf(value) === index);
  const productFamily: ProductSpecFamily =
    categoryNames
      .map(
        (categoryName): ProductSpecFamily => getProductSpecFamily(categoryName)
      )
      .find(
        (family): family is Exclude<ProductSpecFamily, 'general'> =>
          family !== 'general'
      ) ?? 'general';
  const isMobileCategory =
    productFamily === 'mobile' ||
    (productFamily === 'general' &&
      categoryNames.some(isPhoneTabletLaptopCategory));

  return {
    categoryNames,
    hasCameraCategory: categoryNames.some(isCameraLikeCategory),
    hasAccessoryCategory,
    isMobileCategory,
    productFamily,
  };
}
