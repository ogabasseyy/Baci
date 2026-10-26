'use client';
// Reads the client cart context and handles recovery actions.

import Link from 'next/link';
import type { ReactElement, ReactNode } from 'react';
import {
  createElement,
  isValidElement,
  Suspense,
  useEffect,
  useState,
} from 'react';
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
  const [revealed, setRevealed] = useState(false);
  const initialUnresolved =
    !validatedResume &&
    cart.sharedCartEnabled &&
    (cart.syncStatus === 'pending' ||
      (cart.sharedCartRef == null &&
        cart.syncStatus === 'synced' &&
        !cart.isHydrated));
  const capacityBlocked =
    !validatedResume &&
    cart.sharedCartEnabled &&
    (cart.importWarnings?.includes('import_capacity_exceeded') ?? false);
  if (initialUnresolved && !revealed) {
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
    if (revealed)
      return (
        <>
          <CartImportConflicts />
          {renderCheckout(children, () => setRevealed(true))}
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
      {renderCheckout(children, () => setRevealed(true))}
    </>
  );
}

/** Fire onReveal only once the checkout subtree actually commits. */
function RevealMarker({
  children,
  onReveal,
}: {
  children: ReactNode;
  onReveal: () => void;
}) {
  useEffect(() => {
    onReveal();
  }, [onReveal]);
  return children;
}

/**
 * Render checkout through a reveal marker. When the child is a
 * Suspense boundary, the marker goes inside it: a suspended checkout
 * must not count as revealed before it ever commits.
 */
function renderCheckout(children: ReactNode, onReveal: () => void) {
  if (isValidElement(children) && children.type === Suspense) {
    const element = children as ReactElement<{
      children?: ReactNode;
      fallback?: ReactNode;
    }>;
    return createElement(
      Suspense,
      { fallback: element.props.fallback },
      <RevealMarker onReveal={onReveal}>{element.props.children}</RevealMarker>
    );
  }
  return <RevealMarker onReveal={onReveal}>{children}</RevealMarker>;
}
