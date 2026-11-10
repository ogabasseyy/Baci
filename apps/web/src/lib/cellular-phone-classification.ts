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
  /\b(?:cases?|covers?|chargers?|cables?|protectors?|accessor(?:y|ies)|headphones?|earphones?|earbuds?|microphones?|screen protectors?|tempered glass|batter(?:y|ies)|replacements?|parts?|spare parts?)\b/i;

const TABLET_OR_COMPUTER_PRODUCT_PATTERN =
  /\b(?:tablets?|ipads?|galaxy tab|redmi pad|xiaomi pad|oneplus\s+pad|lenovo tab|megapads?|nokia\s+t\s*\d+|laptops?|notebooks?|computers?|macbooks?)\b/i;

const NON_PHONE_PRODUCT_PATTERN = TABLET_OR_COMPUTER_PRODUCT_PATTERN;

const UNAMBIGUOUS_HANDSET_PATTERN =
  /\b(?:iphones?|(?:google\s+)?pixel\s+\d+|galaxy\s+(?:[sazmf]\d+[a-z]*|z\s*(?:fold|flip)|fold|flip)|redmi\s+note|infinix\s+(?:hot|note|zero|smart)|tecno\s+(?:camon|spark|phantom|pop|pova)|itel\s+(?:[aps]\d+|vision)|(?:motorola\s+)?(?:moto\s+[ge]\d+|edge\s+\d+)|xperia\s+\d+)\b/i;

const BARE_MANUFACTURER_PATTERN =
  /\b(?:nokia|tecno|infinix|xiaomi|redmi|oppo|vivo|realme|honor|motorola|zte|asus|oneplus|itel|poco)\b/i;

const PHONE_CATEGORY_PATTERN =
  /(?:^|[\s/_-])(?:smartphones?|phones?|feature[\s_-]*phones?|mobile[\s_-]*phones?|cell[\s_-]*phones?)(?:$|[\s/_-])/i;

const TABLET_OR_COMPUTER_CATEGORY_PATTERN =
  /\b(?:tablets?|ipads?|laptops?|notebooks?|computers?|macbooks?)\b/i;

const ACCESSORY_CATEGORY_PATTERN =
  /\b(?:cases?|covers?|chargers?|cables?|protectors?|accessor(?:y|ies)|headphones?|earphones?|earbuds?|microphones?|smartwatches?|watches?)\b/i;

export function isCellularPhoneProduct(
  product: StorefrontVariantProductContext
): boolean {
  const name = product.name?.trim() ?? '';

  // 1. Exclude accessories and tablets/computers by product name cues.
  if (
    NON_HANDSET_PRODUCT_PATTERN.test(name) ||
    NON_PHONE_PRODUCT_PATTERN.test(name)
  ) {
    return false;
  }

  // 2. Unambiguous handset model identity (e.g. Galaxy S24, iPhone 15, Google Pixel 8, Tecno Camon 30)
  // classifies the product as a phone even in mixed categories such as "Phones & Tablets".
  if (UNAMBIGUOUS_HANDSET_PATTERN.test(name)) {
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

  const hasPhoneCategory = PHONE_CATEGORY_PATTERN.test(categories);
  const hasNonPhoneCategory =
    TABLET_OR_COMPUTER_CATEGORY_PATTERN.test(categories) ||
    ACCESSORY_CATEGORY_PATTERN.test(categories);

  // 3. If a product has an explicit non-phone category (such as Tablets, Laptops, Accessories),
  // do NOT let a bare manufacturer name override that explicit category.
  if (hasNonPhoneCategory && !hasPhoneCategory) {
    return false;
  }

  // 4. In mixed categories (e.g. "Phones & Tablets" or "Mobile Phones & Accessories")
  // lacking an unambiguous handset model, allow bare manufacturer names from phone brands.
  // Otherwise, the non-phone category part disqualifies generic/unbranded items.
  if (hasNonPhoneCategory && hasPhoneCategory) {
    return BARE_MANUFACTURER_PATTERN.test(name);
  }

  // 5. In pure phone categories, classify as phone.
  if (hasPhoneCategory) {
    return true;
  }

  // 6. When category is absent or unclassified, allow bare manufacturer names.
  return BARE_MANUFACTURER_PATTERN.test(name);
}

export const isPhoneLikeProduct = isCellularPhoneProduct;
