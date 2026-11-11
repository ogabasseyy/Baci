import type { CartItem } from './cart-types';

function productUnits(cart: readonly CartItem[], productId: string): number {
  return cart.reduce(
    (sum, item) => (item.id === productId ? sum + item.quantity : sum),
    0
  );
}

/**
 * Units an applied add actually put in the cart for the added product.
 * Stock and per-line caps can accept fewer units than requested, and only
 * that product's lines are compared so no other cart change skews it.
 */
export function countAddedUnits(
  previousCart: readonly CartItem[],
  nextCart: readonly CartItem[],
  productId: string
): number {
  return Math.max(
    0,
    productUnits(nextCart, productId) - productUnits(previousCart, productId)
  );
}
