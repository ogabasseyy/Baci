'use client';
// Reads the client cart context and handles recovery actions.

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';
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
  // Do not mount checkout (and its payment/session hooks) before the
  // initial shared-cart import resolution is known: an empty warnings
  // list on first mount only means the link lifecycle has not reported
  // yet. Once checkout has mounted, later pending/retrying sync must
  // never unmount it (form state lives inside), and a terminal
  // 'retrying' state surfaces in place instead of dead-ending here.
  const revealed = useRef(false);
  const initialUnresolved =
    !validatedResume &&
    cart.sharedCartEnabled &&
    cart.sharedCartRef == null &&
    (cart.syncStatus === 'pending' ||
      (cart.syncStatus === 'synced' && !cart.isHydrated));
  useEffect(() => {
    if (!initialUnresolved) revealed.current = true;
  }, [initialUnresolved]);
  if (initialUnresolved && !revealed.current) {
    return (
      <p role="status" aria-label="Loading your cart">
        Loading your cart…
      </p>
    );
  }
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
