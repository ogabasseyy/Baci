import type { CartItem } from './cart-types';

function totalUnits(cart: readonly CartItem[]): number {
  return cart.reduce((sum, item) => sum + item.quantity, 0);
}

/**
 * Units an applied add actually put in the cart. Stock and per-line caps
 * can accept fewer units than requested, and funnel analytics must report
 * what landed, not what was asked for.
 */
export function countAddedUnits(
  previousCart: readonly CartItem[],
  nextCart: readonly CartItem[]
): number {
  return Math.max(0, totalUnits(nextCart) - totalUnits(previousCart));
}
