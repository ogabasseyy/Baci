import {
  type CommercialSupportBrandProduct,
  resolveCanonicalBrandKey,
} from './resolve-canonical-brand-key';

export function filterProductsByBrandSlugs<
  T extends CommercialSupportBrandProduct,
>(categorySlug: string, products: T[], brandSlugs: string[]): T[] {
  return products.filter((product) => {
    const brandSlug = resolveCanonicalBrandKey(categorySlug, product.brand);
    return Boolean(brandSlug && brandSlugs.includes(brandSlug));
  });
}
