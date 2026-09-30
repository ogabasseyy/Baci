import type { CartItem } from '@/hooks/cart';
import {
  calculateCartCatalogSubtotal,
  calculateCartItemSubtotal,
  calculateCartTotal,
  sanitizeCartItems,
} from '@/lib/checkout/cart-entitlement-sanitizer';

export interface CheckoutCartModel {
  checkoutCart: CartItem[];
  checkoutCartCatalogSubtotal: number;
  checkoutCartTotal: number;
  itemSubtotal: number;
  quoteItemsFingerprint: string;
}

/** Derive the sanitized cart values used by checkout and shipping quotes. */
export function deriveCheckoutCartModel(
  cart: CartItem[],
  hasPriceNegotiation: boolean
): CheckoutCartModel {
  const checkoutCart = sanitizeCartItems(cart, hasPriceNegotiation);

  return {
    checkoutCart,
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
