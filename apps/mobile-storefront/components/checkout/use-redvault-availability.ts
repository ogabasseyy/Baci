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
  const cartFingerprint = items
    .map(
      ({ id, product_id, quantity, variant_id }) =>
        `${id}:${product_id}:${quantity}:${variant_id ?? ''}`
    )
    .join('|');
  const availabilityRequestKey = `${merchantId}:${pilotCartProductId ?? ''}:${isAuthenticated}:${customerId ?? ''}:${cartFingerprint}`;
  const [availability, setAvailability] = useState<{
    requestKey: string;
    available: boolean;
    reason: string;
  } | null>(null);
  // The live pilot requires zero fees, but general REDVAULT does not: hide
  // the method only when the resolved reason is the pilot and a fee applies.
  const pilotFeeBlocked =
    availability?.reason === 'private_live_pilot' &&
    (assuranceFee > 0 || deliveryFee > 0);
  const redvaultAvailable =
    availability?.requestKey === availabilityRequestKey &&
    availability.available &&
    !pilotFeeBlocked;

  useEffect(() => {
    let active = true;
    void getRedvaultPaymentAvailability(merchantId, pilotCartProductId)
      .then((result) => {
        if (active)
          setAvailability({
            requestKey: availabilityRequestKey,
            available: result.available,
            reason: result.reason,
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
  }, [merchantId, pilotCartProductId, availabilityRequestKey]);

  return redvaultAvailable;
}
