import type { CartItem } from './cart-types';

/** Quantities on other lines drawing from the same offer, excluding vouchers. */
export function getOfferCartTotal(
  cart: CartItem[],
  productId: string,
  offerId: string,
  excludeIndex: number
): number {
  return cart.reduce(
    (total, line, index) =>
      index !== excludeIndex &&
      line.id === productId &&
      line.offerId === offerId &&
      line.variantId == null &&
      line.quizAwardId == null &&
      line.quizVoucherToken == null
        ? total + line.quantity
        : total,
    0
  );
}
