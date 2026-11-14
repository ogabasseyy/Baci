import {
  getStorefrontVariantOptions,
  type StorefrontVariantSelection,
} from './storefront-variant-options';

export function buildStorefrontVariantTitle(
  name: string,
  variant: StorefrontVariantSelection
): string {
  const values = Object.entries(getStorefrontVariantOptions(variant)).map(
    ([key, value]) =>
      key === 'condition'
        ? value
            .replaceAll('_', ' ')
            .replace(/\b\w/g, (letter) => letter.toUpperCase())
        : value
  );
  return [name, ...values].join(' - ');
}
