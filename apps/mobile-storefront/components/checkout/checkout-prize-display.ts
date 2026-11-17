import { isQuizVoucherLine } from '@/lib/cart/quiz-voucher-line';
import type { CartItem } from '@/stores/cart-store';

/**
 * True when the cart holds only quiz prizes. The server charges nothing for
 * such an order (the merchant absorbs delivery and VAT), so checkout must not
 * show a delivery fee, VAT or an amount to pay.
 */
export function isPrizeOnlyCheckout(items: CartItem[]): boolean {
  return items.length > 0 && items.every(isQuizVoucherLine);
}
