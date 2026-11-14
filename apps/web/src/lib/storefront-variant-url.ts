import {
  getStorefrontVariantOptions,
  type StorefrontVariantSelection,
} from './storefront-variant-options';

export function buildStorefrontVariantUrl(
  productUrl: string,
  variant: StorefrontVariantSelection
): string {
  const isRelative = productUrl.startsWith('/');
  const url = isRelative
    ? new URL(productUrl, 'http://localhost')
    : new URL(productUrl);
  url.searchParams.set('variantId', variant.id);
  for (const [key, value] of Object.entries(
    getStorefrontVariantOptions(variant)
  )) {
    url.searchParams.set(key, value);
  }
  return isRelative
    ? `${url.pathname}${url.search}${url.hash}`
    : url.toString();
}
