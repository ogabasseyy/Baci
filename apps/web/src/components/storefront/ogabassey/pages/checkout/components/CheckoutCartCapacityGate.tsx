'use client';
// Reads the client cart context and handles recovery actions.

import Link from 'next/link';
import type { ReactNode } from 'react';
import { CartImportConflicts } from '@/components/storefront/cart/cart-import-conflicts';
import { Button } from '@/components/ui/button';
import { useCart } from '@/hooks/cart';
import { asRoute } from '@/lib/routes';

/** Keep capacity recovery reachable when a shopper opens checkout directly. */
export function CheckoutCartCapacityGate({
  children,
  onReturnToCart,
  cartHref,
  validatedResume = false,
}: {
  children: ReactNode;
  onReturnToCart?: () => void;
  cartHref?: string;
  validatedResume?: boolean;
}) {
  const cart = useCart();
  if (
    !validatedResume &&
    cart.sharedCartEnabled &&
    cart.importWarnings?.includes('import_capacity_exceeded')
  ) {
    return (
      <>
        <CartImportConflicts />
        {cartHref ? (
          <Button asChild>
            <Link href={asRoute(cartHref)}>Edit cart items</Link>
          </Button>
        ) : (
          <Button type="button" onClick={onReturnToCart}>
            Edit cart items
          </Button>
        )}
      </>
    );
  }
  return children;
}
