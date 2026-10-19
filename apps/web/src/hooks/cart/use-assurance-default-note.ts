'use client';

import {
  resolveAssuranceDefault,
  resolveAssuranceLabel,
  resolveAssuranceMerchantSetting,
} from '@baci/shared/lib';
import { useMerchantSafe } from '@/hooks/merchant/use-merchant';
import { useCartSafe } from './cart-context';

export type AssuranceDefaultNote = {
  visible: boolean;
  label: string;
};

/**
 * Whether the add-to-cart surface should disclose the assurance default.
 * Mirrors the providers' add-time resolution exactly (same shared
 * resolvers): the note shows only when a fresh add would default the
 * fee on, so it never cries wolf on opt-out paths. Callers additionally
 * gate on purchasability and an empty line (quantityInCart === 0).
 */
export function useAssuranceDefaultNote(): AssuranceDefaultNote {
  const cart = useCartSafe();
  const merchantContext = useMerchantSafe();
  const cartSlug = cart?.merchantSlug ?? null;
  const label = resolveAssuranceLabel(cartSlug);
  if (!cart?.isHydrated) {
    return { visible: false, label };
  }
  const contextMerchant = merchantContext?.merchant;
  const visible = resolveAssuranceDefault({
    smartCartProEnabled: cart.hasSmartCartPro,
    merchantSlug: cartSlug,
    shippingInsuranceEnabled: resolveAssuranceMerchantSetting({
      contextSlug: contextMerchant?.slug,
      contextSetting:
        contextMerchant?.feature_settings?.shipping_insurance_enabled,
      cartSlug,
    }),
  });
  return { visible, label };
}
