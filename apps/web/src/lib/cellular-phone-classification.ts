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

const NON_HANDSET_PATTERN =
  /\b(?:cases?|covers?|chargers?|cables?|protectors?|accessor(?:y|ies)|headphones?|earphones?|earbuds?|microphones?)\b/i;

export function isCellularPhoneProduct(
  product: StorefrontVariantProductContext
): boolean {
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
  if (
    /\b(tablets?|ipads?|laptops?|computers?)\b/i.test(categories) ||
    NON_HANDSET_PATTERN.test(`${categories} ${product.name ?? ''}`)
  ) {
    return false;
  }
  return (
    /(?:^|[\s/_-])(?:smartphones?|phones?|feature[\s_-]*phones?)(?:$|[\s/_-])/i.test(
      categories
    ) ||
    /\b(?:iphone|google pixel|pixel \d|galaxy [sazmf]\d)/i.test(
      product.name ?? ''
    )
  );
}

export const isPhoneLikeProduct = isCellularPhoneProduct;
