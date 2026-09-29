import { useEffect, useState } from 'react';
import { getRedvaultPaymentAvailability } from '@/services/redvault';
import type { useCartStore } from '@/stores/cart-store';

type CartItems = ReturnType<typeof useCartStore.getState>['items'];

export function useRedvaultAvailability({
  customerId,
  isAuthenticated,
  items,
  merchantId,
}: {
  customerId?: string | null;
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
  } | null>(null);
  const redvaultAvailable =
    availability?.requestKey === availabilityRequestKey &&
    availability.available;

  useEffect(() => {
    let active = true;
    void getRedvaultPaymentAvailability(merchantId, pilotCartProductId)
      .then((available) => {
        if (active)
          setAvailability({ requestKey: availabilityRequestKey, available });
      })
      .catch(() => {
        if (active)
          setAvailability({
            requestKey: availabilityRequestKey,
            available: false,
          });
      });
    return () => {
      active = false;
    };
  }, [merchantId, pilotCartProductId, availabilityRequestKey]);

  return redvaultAvailable;
}
