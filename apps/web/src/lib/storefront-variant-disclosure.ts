import { isRestrictedWifiOnlyVariant } from './restricted-wifi-variant';
import type { StorefrontVariantSelection } from './storefront-variant-options';

export function getVariantConnectivityDisclosure(
  variant: StorefrontVariantSelection
): string | undefined {
  return isRestrictedWifiOnlyVariant(variant)
    ? 'Listed as Wi-Fi only. Do not assume cellular service support; confirm connectivity limitations before purchase.'
    : undefined;
}
