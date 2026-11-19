import {
  isCellularPhoneProduct,
  type StorefrontVariantProductContext,
} from './cellular-phone-classification';
import { isRestrictedWifiOnlyVariant } from './restricted-wifi-variant';

/** Phone defaults exclude restricted units; normal Wi-Fi tablets stay eligible. */
export function filterDefaultAdvertisedVariants<
  T extends { attributes?: Record<string, unknown> | null },
>(variants: readonly T[], product: StorefrontVariantProductContext): T[] {
  return isCellularPhoneProduct(product)
    ? variants.filter((variant) => !isRestrictedWifiOnlyVariant(variant))
    : [...variants];
}
