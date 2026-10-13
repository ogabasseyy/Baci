import { pruneExpiredVoucherCartLines } from '@/lib/checkout/quiz-voucher-expiry';
import {
  getCartFromStorage,
  getCartWideNegotiationFromStorage,
} from './cart-storage';
import type { CartItem } from './cart-types';

export interface MerchantCartState {
  cart: CartItem[];
  cartWideNegotiationActive: boolean;
}

export function getMerchantCartState(
  merchantSlug: string | null | undefined
): MerchantCartState {
  return {
    cart: pruneExpiredVoucherCartLines(getCartFromStorage(merchantSlug)),
    cartWideNegotiationActive: getCartWideNegotiationFromStorage(merchantSlug),
  };
}
