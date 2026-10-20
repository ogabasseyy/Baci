'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
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
  allowOrderResume = false,
}: {
  children: ReactNode;
  onReturnToCart?: () => void;
  cartHref?: string;
  allowOrderResume?: boolean;
}) {
  const cart = useCart();
  const orderId = useSearchParams().get('orderId');
  if (
    !(allowOrderResume && orderId) &&
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
