import type { CartItem } from './cart-types';

function productUnits(
  cart: readonly CartItem[],
  productId: string | number
): number {
  // Template products can carry numeric ids: compare as strings.
  return cart.reduce(
    (sum, item) =>
      String(item.id) === String(productId) ? sum + item.quantity : sum,
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
  productId: string | number
): number {
  return Math.max(
    0,
    productUnits(nextCart, productId) - productUnits(previousCart, productId)
  );
}
