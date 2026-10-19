import type { StoreApi } from 'zustand';
import { clearGroupNegotiation } from './cart-store-selectors';
import type { CartState } from './cart-store-state';
import { forwardSharedCartWrite } from './shared-cart-writer';

/** Per-line and cart-wide negotiated-price actions for the local cart. */
export function createCartNegotiationActions(
  set: StoreApi<CartState>['setState'],
  get: StoreApi<CartState>['getState']
): Pick<
  CartState,
  'applyNegotiatedPrice' | 'applyCartWideNegotiation' | 'clearNegotiatedPrice'
> {
  return {
    applyNegotiatedPrice: (id, negotiatedPrice) => {
      const forwarded = forwardSharedCartWrite({
        type: 'negotiate',
        id,
        price: negotiatedPrice,
      });
      if (forwarded) return;
      set((state) => {
        const base = state.cartWideNegotiationActive
          ? clearGroupNegotiation(state.items)
          : state.items;
        return {
          items: base.map((item) =>
            item.id === id
              ? {
                  ...item,
                  negotiatedPrice,
                  negotiationStatus: 'accepted' as const,
                }
              : item
          ),
          cartWideNegotiationActive: false,
        };
      });
    },

    applyCartWideNegotiation: (newTotal) => {
      const forwarded = forwardSharedCartWrite({
        type: 'negotiate_group',
        total: newTotal,
      });
      if (forwarded) return;
      const { items } = get();
      const currentTotal = items.reduce((sum, item) => {
        const price = item.negotiatedPrice ?? item.price;
        return sum + price * item.quantity;
      }, 0);

      if (currentTotal <= 0) return;
      const ratio = newTotal / currentTotal;

      set((state) => ({
        items: state.items.map((item) => {
          const currentPrice = item.negotiatedPrice ?? item.price;
          return {
            ...item,
            negotiatedPrice: Math.round(currentPrice * ratio),
            negotiationStatus: 'accepted' as const,
          };
        }),
        cartWideNegotiationActive: true,
      }));
    },

    clearNegotiatedPrice: (id) => {
      const forwarded = forwardSharedCartWrite({
        type: 'clear_negotiation',
        id,
      });
      if (forwarded) return;
      set((state) => ({
        items: state.items.map((item) =>
          item.id === id
            ? {
                ...item,
                negotiatedPrice: undefined,
                negotiationStatus: undefined,
              }
            : item
        ),
        cartWideNegotiationActive: false,
      }));
    },
  };
}
