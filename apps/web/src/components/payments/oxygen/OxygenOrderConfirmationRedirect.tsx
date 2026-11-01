'use client';

import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useRef } from 'react';
import { useCartSafe } from '@/hooks/cart';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import { asRoute } from '@/lib/routes';
import { OxygenOrderConfirmationContext } from './OxygenPaymentSurfaceContext';
import { cleanupOxygenCompletedCheckout } from './oxygen-checkout-cleanup';

/** Navigation only: confirmed activation never writes payment or settlement state. */
export function OxygenOrderConfirmationRedirect({
  orderId,
  merchantId,
  merchantSlug,
  children,
}: {
  orderId: string;
  merchantId?: string;
  merchantSlug: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const merchant = useMerchantSafe();
  const cart = useCartSafe();
  const navigated = useRef<string | null>(null);
  const waitingForCart = useRef(false);
  useEffect(() => {
    if (waitingForCart.current && (!cart || cart.isHydrated)) {
      waitingForCart.current = false;
      complete();
    }
  });
  function complete() {
    if (navigated.current === orderId) return;
    if (cart && !cart.isHydrated) {
      waitingForCart.current = true;
      return;
    }
    navigated.current = orderId;
    if (merchantId)
      void cleanupOxygenCompletedCheckout(orderId, merchantId, {
        merchantSlug,
        cart,
      });
    const basePath =
      merchant?.basePath ?? `/${encodeURIComponent(merchantSlug)}`;
    const query = new URLSearchParams({ orderId, type: 'oxygen' });
    router.replace(asRoute(`${basePath}/order-success?${query.toString()}`));
  }
  return (
    <OxygenOrderConfirmationContext.Provider value={complete}>
      {children}
    </OxygenOrderConfirmationContext.Provider>
  );
}
