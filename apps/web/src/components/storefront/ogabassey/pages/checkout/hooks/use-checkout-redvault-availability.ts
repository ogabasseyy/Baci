'use client';

import { useRedvaultPaymentAvailability } from './use-redvault-payment-availability';
import { useStorefrontCustomerSession } from './use-storefront-customer-session';

type CheckoutCartItem = {
  id: string;
  quantity: number;
  variantId?: string | null;
};

export function useCheckoutRedvaultAvailability({
  cartItems,
  merchantId,
  merchantSlug,
  userId,
}: {
  cartItems: readonly CheckoutCartItem[];
  merchantId?: string | null;
  merchantSlug?: string;
  userId?: string | null;
}) {
  const storefrontCustomerSession = useStorefrontCustomerSession(merchantSlug);
  const pilotCartProductId =
    cartItems.length === 1 &&
    cartItems[0]?.quantity === 1 &&
    !cartItems[0]?.variantId
      ? cartItems[0].id
      : undefined;
  const cartFingerprint = cartItems
    .map(({ id, quantity, variantId }) => `${id}:${quantity}:${variantId ?? ''}`)
    .join('|');
  const availability = useRedvaultPaymentAvailability(
    merchantId,
    pilotCartProductId,
    `${userId ?? ''}:${storefrontCustomerSession.status}:${storefrontCustomerSession.revision}:${cartFingerprint}`
  );

  return {
    availability,
    waitForResolvedAuthenticated:
      storefrontCustomerSession.waitForResolvedAuthenticated,
  };
}
