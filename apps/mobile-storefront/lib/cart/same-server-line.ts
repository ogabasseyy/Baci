import { cartLineIdentity } from '@baci/shared/cart';
import type { CartItem } from '@/stores/cart-store.types';
import { nativeCartInput } from './display';

/**
 * Whether a server-hydrated line is the one a local add produced, judged by
 * the identity the server uses (product, variant, condition, options and
 * voucher) rather than display-only fields such as offer ids.
 */
export function sameServerLine(
  hydrated: CartItem,
  added: Omit<CartItem, 'id'>
): boolean {
  try {
    return (
      cartLineIdentity(nativeCartInput(hydrated).item) ===
        cartLineIdentity(nativeCartInput(added).item) &&
      hydrated.voucher_award_id === added.voucher_award_id &&
      hydrated.voucher_token === added.voucher_token
    );
  } catch {
    return false;
  }
}
