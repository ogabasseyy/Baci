import type { CartState } from './cart-store-state';

export function partializeCartStore(state: CartState) {
  return {
    ...(state.sharedCartRef ? { sharedCartRef: state.sharedCartRef } : {}),
    cartWideNegotiationActive: state.cartWideNegotiationActive,
    checkoutGeneration: state.checkoutGeneration,
    items: state.items,
    lineSequence: state.lineSequence,
  };
}
