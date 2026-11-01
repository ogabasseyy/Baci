'use client';

import { useRouter } from 'next/navigation';
import { type ReactNode, useRef } from 'react';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import { asRoute } from '@/lib/routes';
import { OxygenOrderConfirmationContext } from './OxygenPaymentSurfaceContext';

/** Navigation only: confirmed activation never writes payment or settlement state. */
export function OxygenOrderConfirmationRedirect({
  orderId,
  merchantSlug,
  children,
}: {
  orderId: string;
  merchantSlug: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const merchant = useMerchantSafe();
  const navigated = useRef<string | null>(null);
  function complete() {
    if (navigated.current === orderId) return;
    navigated.current = orderId;
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
