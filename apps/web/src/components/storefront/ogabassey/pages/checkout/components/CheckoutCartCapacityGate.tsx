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
  const capacityBlocked =
    !validatedResume &&
    cart.sharedCartEnabled &&
    (cart.importWarnings?.includes('import_capacity_exceeded') ?? false);
  // Only an actual render of the checkout children counts as revealed:
  // a capacity-blocked render must not arm the in-place branch.
  useEffect(() => {
    if (!initialUnresolved && !capacityBlocked) revealed.current = true;
  }, [initialUnresolved, capacityBlocked]);
  if (initialUnresolved && !revealed.current) {
    return (
      <p role="status" aria-label="Loading your cart">
        Loading your cart…
      </p>
    );
  }
  if (capacityBlocked) {
    // Once checkout has mounted, never swap it out from under the
    // shopper: surface the recovery in place above the live form.
    // The checkout child keeps a stable sibling position (after the
    // recovery slot) so toggling the panel cannot remount it.
    if (revealed.current)
      return (
        <>
          <CartImportConflicts />
          {children}
        </>
      );
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
  // Keep the same fragment shape as the in-place recovery branch so
  // the checkout child stays at a stable position across toggles.
  return (
    <>
      {null}
      {children}
    </>
  );
}
