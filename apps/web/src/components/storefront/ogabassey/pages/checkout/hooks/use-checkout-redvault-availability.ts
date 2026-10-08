'use client';

import { useRedvaultPaymentAvailability } from './use-redvault-payment-availability';
import {
  type StorefrontCustomerSession,
  useStorefrontCustomerSession,
} from './use-storefront-customer-session';

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
  pilotFeeBlockers,
  customerSession,
}: {
  cartItems: readonly CheckoutCartItem[];
  merchantId?: string | null;
  merchantSlug?: string;
  userId?: string | null;
  pilotFeeBlockers?: {
    hasAssurance: boolean;
    shippingFee: number;
    giftWrappingCost: number;
  };
  // Callers that already resolve the storefront session pass it in so this
  // hook does not mount a second session instance (double fetch plus a
  // second, divergent revision counter feeding the availability keys).
  customerSession?: StorefrontCustomerSession;
}) {
  const fallbackSession = useStorefrontCustomerSession(
    customerSession ? undefined : merchantSlug
  );
  const storefrontCustomerSession = customerSession ?? fallbackSession;
  const pilotCartProductId =
    cartItems.length === 1 &&
    cartItems[0]?.quantity === 1 &&
    !cartItems[0]?.variantId
      ? cartItems[0].id
      : undefined;
  const cartFingerprint = cartItems
    .map(({ id, quantity, variantId }) => `${id}:${quantity}:${variantId ?? ''}`)
    .join('|');
  // The preserved identity keys on the resolved storefront account, not just
  // the (possibly absent) auth-context user: this route mounts no AuthProvider,
  // so without the session account id a sign-out or account switch would keep
  // serving the previous account's positive result while revalidating.
  const availability = useRedvaultPaymentAvailability(
    merchantId,
    pilotCartProductId,
    `${userId ?? ''}:${storefrontCustomerSession.status}:${storefrontCustomerSession.revision}:${cartFingerprint}`,
    `${userId ?? ''}:${storefrontCustomerSession.accountId ?? ''}:${cartFingerprint}`
  );
  // The live pilot requires zero fees, but general REDVAULT does not: hide
  // the method only when the resolved reason is the pilot and a fee applies.
  // Toggling a fee re-renders into (or out of) this override immediately.
  const pilotFeeBlocked =
    availability.reason === 'private_live_pilot' &&
    (pilotFeeBlockers?.hasAssurance === true ||
      (pilotFeeBlockers?.shippingFee ?? 0) > 0 ||
      (pilotFeeBlockers?.giftWrappingCost ?? 0) > 0);

  return {
    availability: pilotFeeBlocked
      ? { available: false, reason: 'unavailable' }
      : availability,
    waitForResolvedAuthenticated:
      storefrontCustomerSession.waitForResolvedAuthenticated,
  };
}
