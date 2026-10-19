import type { CartItem } from '@/hooks/cart';
import {
  calculateCartCatalogSubtotal,
  calculateCartItemSubtotal,
  calculateCartTotal,
  sanitizeCartItems,
} from '@/lib/checkout/cart-entitlement-sanitizer';

export interface SharedCartRef {
  cartId: string;
  version: number;
}

export interface CheckoutCartModel {
  checkoutCart: CartItem[];
  checkoutCartCatalogSubtotal: number;
  checkoutCartTotal: number;
  itemSubtotal: number;
  quoteItemsFingerprint: string;
  /** Authoritative cart identity for bound checkout; null for legacy carts. */
  sharedCartRef: SharedCartRef | null;
}

/** Derive the sanitized cart values used by checkout and shipping quotes. */
export function deriveCheckoutCartModel(
  cart: CartItem[],
  hasPriceNegotiation: boolean,
  sharedCartRef?: SharedCartRef | null
): CheckoutCartModel {
  const checkoutCart = sanitizeCartItems(cart, hasPriceNegotiation);

  return {
    checkoutCart,
    sharedCartRef: sharedCartRef ?? null,
    // Shipping tiers use catalog goods prices even when the buyer has an
    // entitled negotiated checkout price; the order endpoint verifies the
    // quote against the same canonical catalog subtotal.
    checkoutCartCatalogSubtotal: calculateCartCatalogSubtotal(
      checkoutCart,
      hasPriceNegotiation
    ),
    checkoutCartTotal: calculateCartTotal(checkoutCart, hasPriceNegotiation),
    itemSubtotal: calculateCartItemSubtotal(checkoutCart, hasPriceNegotiation),
    quoteItemsFingerprint: checkoutCart
      .map(
        ({ id, negotiatedPrice, price, quantity }) =>
          `${id}:${quantity}:${negotiatedPrice ?? price}`
      )
      .join('|'),
  };
}
