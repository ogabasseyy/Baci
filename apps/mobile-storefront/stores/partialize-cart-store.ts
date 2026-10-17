import type { CartState } from './cart-store-state';

export function partializeCartStore(state: CartState) {
  return {
    ...(state.sharedCartRef ? { sharedCartRef: state.sharedCartRef } : {}),
    cartWideNegotiationActive: state.cartWideNegotiationActive,
    checkoutGeneration: state.checkoutGeneration,
    // Voucher credentials live only in memory on every path: the
    // persisted store (MMKV/AsyncStorage) is not encrypted storage.
    // Shared carts rehydrate them from the authoritative snapshot
    // after restart; legacy lines simply reprice without the award.
    items: state.items.map((item) => {
      const { voucher_token, voucher_award_id, ...rest } = item;
      void voucher_token;
      void voucher_award_id;
      return rest;
    }),
    lineSequence: state.lineSequence,
  };
}
