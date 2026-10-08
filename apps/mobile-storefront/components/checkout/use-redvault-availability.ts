import { useEffect, useState } from 'react';
import { getRedvaultPaymentAvailability } from '@/services/redvault';
import type { useCartStore } from '@/stores/cart-store';

type CartItems = ReturnType<typeof useCartStore.getState>['items'];

export function useRedvaultAvailability({
  assuranceFee = 0,
  customerId,
  deliveryFee = 0,
  isAuthenticated,
  items,
  merchantId,
}: {
  assuranceFee?: number;
  customerId?: string | null;
  deliveryFee?: number;
  isAuthenticated: boolean;
  items: CartItems;
  merchantId: string;
}) {
  const pilotCartProductId =
    items.length === 1 && items[0]?.quantity === 1 && !items[0]?.variant_id
      ? items[0].product_id
      : undefined;
  // The fingerprint includes the unit price so a repriced basket hides
  // the method pending refresh instead of retaining a stale positive
  // until the server rejects. Fee combinations without a client-side
  // value at this layer (gift wrapping, wallet/savings) stay server-gated.
  const cartFingerprint = items
    .map(
      ({ id, product_id, price, quantity, variant_id }) =>
        `${id}:${product_id}:${quantity}:${variant_id ?? ''}:${price ?? ''}`
    )
    .join('|');
  const availabilityRequestKey = `${merchantId}:${pilotCartProductId ?? ''}:${isAuthenticated}:${customerId ?? ''}:${cartFingerprint}`;
  const [availability, setAvailability] = useState<{
    requestKey: string;
    available: boolean;
    reason: string;
    expiresAt?: number;
  } | null>(null);
  // Bumped when the pilot expiry passes so a checkout left open past the
  // short pilot window revalidates instead of retaining a stale positive.
  const [refreshNonce, setRefreshNonce] = useState(0);
  // The live pilot requires zero fees, but general REDVAULT does not: hide
  // the method only when the resolved reason is the pilot and a fee applies.
  const pilotFeeBlocked =
    availability?.reason === 'private_live_pilot' &&
    (assuranceFee > 0 || deliveryFee > 0);
  const expired =
    availability?.available === true &&
    typeof availability.expiresAt === 'number' &&
    availability.expiresAt <= Date.now();
  const redvaultAvailable =
    availability?.requestKey === availabilityRequestKey &&
    availability.available &&
    !expired &&
    !pilotFeeBlocked;

  useEffect(() => {
    // Read so expiry invalidation retriggers this effect.
    void refreshNonce;
    let active = true;
    void getRedvaultPaymentAvailability(merchantId, pilotCartProductId)
      .then((result) => {
        if (active)
          setAvailability({
            requestKey: availabilityRequestKey,
            available: result.available,
            reason: result.reason,
            ...(result.expiresAt === undefined
              ? {}
              : { expiresAt: result.expiresAt }),
          });
      })
      .catch(() => {
        if (active)
          setAvailability({
            requestKey: availabilityRequestKey,
            available: false,
            reason: 'unavailable',
          });
      });
    return () => {
      active = false;
    };
  }, [merchantId, pilotCartProductId, availabilityRequestKey, refreshNonce]);

  const resolvedExpiresAt =
    availability?.available === true ? availability.expiresAt : undefined;
  useEffect(() => {
    // Revalidate exactly when the pilot window ends. An already-passed
    // expiry schedules nothing (the render gate above already fails
    // closed); the next render or request-key change revalidates.
    if (resolvedExpiresAt === undefined) return;
    const delay = resolvedExpiresAt - Date.now();
    if (!(delay > 0)) return;
    const timer = setTimeout(
      () => setRefreshNonce((nonce) => nonce + 1),
      Math.min(delay, 2_147_483_647)
    );
    return () => clearTimeout(timer);
  }, [resolvedExpiresAt]);

  return redvaultAvailable;
}
