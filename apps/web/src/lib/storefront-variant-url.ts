import {
  getStorefrontVariantOptions,
  type StorefrontVariantSelection,
} from './storefront-variant-options';

export function buildStorefrontVariantUrl(
  productUrl: string,
  variant: StorefrontVariantSelection
): string {
  const url = new URL(productUrl);
  url.searchParams.set('variantId', variant.id);
  for (const [key, value] of Object.entries(
    getStorefrontVariantOptions(variant)
  )) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}
