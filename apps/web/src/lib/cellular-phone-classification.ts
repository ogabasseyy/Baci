export interface StorefrontVariantProductContext {
  name?: string | null;
  category?: string | null;
  category_slug?: string | null;
  categories?:
    | { name?: string | null; slug?: string | null }
    | Array<{ name?: string | null; slug?: string | null }>
    | null;
  product_categories?: Array<{
    categories?:
      | { name?: string | null; slug?: string | null }
      | Array<{ name?: string | null; slug?: string | null }>
      | null;
  }> | null;
}

export type ProductClassificationContext = StorefrontVariantProductContext;

const NON_HANDSET_PRODUCT_PATTERN =
  /\b(?:cases?|covers?|chargers?|cables?|protectors?|accessor(?:y|ies)|headphones?|earphones?|earbuds?|microphones?|screen protectors?|tempered glass)\b/i;

const TABLET_OR_COMPUTER_PRODUCT_PATTERN =
  /\b(?:tablets?|ipads?|galaxy tab|redmi pad|xiaomi pad|lenovo tab|laptops?|notebooks?|computers?|macbooks?)\b/i;

const EXPLICIT_HANDSET_PATTERN =
  /\b(?:iphones?|google pixel|pixel \d|galaxy [sazmf]\d)/i;

const PHONE_CATEGORY_PATTERN =
  /(?:^|[\s/_-])(?:smartphones?|phones?|feature[\s_-]*phones?|mobile[\s_-]*phones?|cell[\s_-]*phones?)(?:$|[\s/_-])/i;

const TABLET_OR_COMPUTER_CATEGORY_PATTERN =
  /\b(?:tablets?|ipads?|laptops?|computers?)\b/i;

const ACCESSORY_CATEGORY_PATTERN =
  /\b(?:cases?|covers?|chargers?|cables?|protectors?|accessor(?:y|ies)|headphones?|earphones?|earbuds?|microphones?)\b/i;

export function isCellularPhoneProduct(
  product: StorefrontVariantProductContext
): boolean {
  const name = product.name?.trim() ?? '';

  // 1. Exclude accessories and tablets/computers by product name cues.
  if (
    NON_HANDSET_PRODUCT_PATTERN.test(name) ||
    TABLET_OR_COMPUTER_PRODUCT_PATTERN.test(name)
  ) {
    return false;
  }

  // 2. Explicit handset identity (e.g. Galaxy S24, iPhone 15, Google Pixel 8)
  // resolves mixed categories such as "Phones & Tablets" or "Mobile Phones & Accessories".
  if (EXPLICIT_HANDSET_PATTERN.test(name)) {
    return true;
  }

  const directCategories = Array.isArray(product.categories)
    ? product.categories
    : product.categories
      ? [product.categories]
      : [];
  const joinedProductCategories = Array.isArray(product.product_categories)
    ? product.product_categories.flatMap((pc) => {
        if (!pc?.categories) return [];
        return Array.isArray(pc.categories) ? pc.categories : [pc.categories];
      })
    : [];
  const categories = [
    product.category,
    product.category_slug,
    ...directCategories.flatMap((category) => [category?.name, category?.slug]),
    ...joinedProductCategories.flatMap((category) => [
      category?.name,
      category?.slug,
    ]),
  ]
    .filter(Boolean)
    .join(' ');

  // 3. When lacking explicit handset identity, categories matching tablets,
  // computers, or accessories disqualify the product.
  if (
    TABLET_OR_COMPUTER_CATEGORY_PATTERN.test(categories) ||
    ACCESSORY_CATEGORY_PATTERN.test(categories)
  ) {
    return false;
  }

  return PHONE_CATEGORY_PATTERN.test(categories);
}

export const isPhoneLikeProduct = isCellularPhoneProduct;
