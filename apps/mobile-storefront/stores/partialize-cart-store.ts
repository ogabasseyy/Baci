import type { CartState } from './cart-store-state';

export function partializeCartStore(state: CartState) {
  return {
    ...(state.sharedCartRef ? { sharedCartRef: state.sharedCartRef } : {}),
    cartWideNegotiationActive: state.cartWideNegotiationActive,
    checkoutGeneration: state.checkoutGeneration,
    // Shared-cart voucher credentials live only in memory: the
    // authoritative snapshot rehydrates them after restart, and the
    // persisted store (MMKV/AsyncStorage) is not encrypted storage.
    items: state.sharedCartRef
      ? state.items.map((item) => {
          const { voucher_token, voucher_award_id, ...rest } = item;
          void voucher_token;
          void voucher_award_id;
          return rest;
        })
      : state.items,
    lineSequence: state.lineSequence,
  };
}
