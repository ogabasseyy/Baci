'use client';

import type { ReactNode } from 'react';
import { CartImportConflicts } from '@/components/storefront/cart/cart-import-conflicts';
import { useCart } from '@/hooks/cart';

/** Keep capacity recovery reachable when a shopper opens checkout directly. */
export function CheckoutCartCapacityGate({ children }: { children: ReactNode }) {
  const cart = useCart();
  if (
    cart.sharedCartEnabled &&
    cart.importWarnings?.includes('import_capacity_exceeded')
  ) {
    return <CartImportConflicts />;
  }
  return children;
}
