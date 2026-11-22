import type { CartItem } from '@/hooks/cart';
import { calculateCartCatalogSubtotal } from '@/lib/checkout/cart-entitlement-sanitizer';

/**
 * The delivery options the widget shows are quoted on the cart's own subtotal,
 * while `/api/orders` verifies a merchant rate against the catalog-priced
 * canonical subtotal including assurance (`calculateCartCatalogSubtotal`
 * mirrors it). Chat checkout supports only carts where both bases agree, so a
 * threshold rate it quotes is the rate the order will accept.
 */
export function isChatwootCheckoutSubtotalBasisEqual(
  display: CartItem[],
  itemsSubtotalMinor: number
): boolean {
  return (
    Math.abs(
      calculateCartCatalogSubtotal(display, true) - itemsSubtotalMinor / 100
    ) <= 0.005
  );
}
