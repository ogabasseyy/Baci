import type { CartItem } from '@/stores/cart-store';

export function isQuizVoucherLine(item: CartItem): boolean {
  // Only a complete token-and-award pair is voucher-backed; a partial
  // pair is an ordinary priced line with editable quantity.
  return Boolean(item.voucher_token && item.voucher_award_id);
}
