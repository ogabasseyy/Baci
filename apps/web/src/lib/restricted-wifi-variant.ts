import {
  getStorefrontVariantOptions,
  type StorefrontVariantSelection,
} from './storefront-variant-options';

export function isRestrictedWifiOnlyVariant(
  variant: Pick<StorefrontVariantSelection, 'attributes'>
): boolean {
  const options = getStorefrontVariantOptions({ ...variant, id: '' });
  return ['sim_type', 'connectivity'].some((key) =>
    /^wi[\s-]*fi[\s-]*only$/i.test(options[key] ?? '')
  );
}
