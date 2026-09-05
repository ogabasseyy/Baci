import * as Crypto from 'expo-crypto';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { syncStorage } from '../lib/storage';
import {
  createCartLineId,
  isSameCartLine,
  mergeExistingCartItem,
} from './cart-line';
import type { CartItem } from './cart-store.types';
import {
  applyReprice,
  clearGroupNegotiation,
  formatPrice,
  selectCartQuantities,
} from './cart-store-selectors';
import type { CartState } from './cart-store-state';
import { emptyCheckoutCart } from './empty-checkout-cart';

export type { CartItem } from './cart-store.types';
export { formatPrice, selectCartQuantities };

export function resetCartLineSequence() {
  if (useCartStore.getState().items.length === 0) {
    useCartStore.setState({ lineSequence: 0 });
  }
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      // Initial state
      items: [],
      isLoading: false,
      lineSequence: 0,
      checkoutGeneration: 'legacy',
      cartWideNegotiationActive: false,

      // Computed values
      itemCount: () => {
        return get().items.reduce((total, item) => total + item.quantity, 0);
      },

      subtotal: () => {
        return get().items.reduce((total, item) => {
          // Use negotiated price if available (matches web behavior)
          const effectivePrice = item.negotiatedPrice ?? item.price;
          const itemTotal = effectivePrice * item.quantity;
          // Assurance is calculated separately in UI/checkout layer
          // DO NOT include assurance here to avoid double-counting
          return total + itemTotal;
        }, 0);
      },

      totalSavings: () => {
        return get().items.reduce((total, item) => {
          if (item.compare_at_price && item.compare_at_price > item.price) {
            return total + (item.compare_at_price - item.price) * item.quantity;
          }
          return total;
        }, 0);
      },

      // Add item to cart
      addItem: (item) => {
        set((state) => {
          const itemToAdd =
            item.voucher_token || item.voucher_award_id
              ? { ...item, quantity: 1 }
              : item;

          // Check if item already exists (same product + variant + options)
          const existingIndex = state.items.findIndex((existingItem) =>
            isSameCartLine(existingItem, itemToAdd)
          );

          const checkoutGeneration =
            state.items.length === 0
              ? Crypto.randomUUID()
              : state.checkoutGeneration;
          let items: CartItem[];
          let lineSequence = state.lineSequence;
          if (existingIndex >= 0) {
            // Refresh cart metadata from the latest add while preserving cart-only state.
            items = [...state.items];
            items[existingIndex] = mergeExistingCartItem(
              items[existingIndex],
              itemToAdd
            );
          } else {
            lineSequence = state.lineSequence + 1;
            items = [
              ...state.items,
              { ...itemToAdd, id: createCartLineId(itemToAdd, lineSequence) },
            ];
          }

          // Adding or merging a line changes the cart composition, so an active
          // cart-wide negotiation no longer represents the agreed total — reset
          // it (and the newly added units never inherit a stale group share).
          if (state.cartWideNegotiationActive) {
            return {
              items: clearGroupNegotiation(items),
              lineSequence,
              checkoutGeneration,
              cartWideNegotiationActive: false,
            };
          }

          return { items, lineSequence, checkoutGeneration };
        });
      },

      // Remove item from cart
      removeItem: (id) => {
        set((state) => {
          const items = state.items.filter((item) => item.id !== id);

          // Removing a line breaks any cart-wide negotiated total, so reset the
          // group deal and revert remaining lines to catalog price.
          if (state.cartWideNegotiationActive) {
            return {
              items: clearGroupNegotiation(items),
              cartWideNegotiationActive: false,
            };
          }

          return { items };
        });
      },

      // Update item quantity
      updateQuantity: (id, quantity) => {
        set((state) => {
          if (quantity <= 0) {
            const items = state.items.filter((item) => item.id !== id);
            if (state.cartWideNegotiationActive) {
              return {
                items: clearGroupNegotiation(items),
                cartWideNegotiationActive: false,
              };
            }
            return { items };
          }

          const items = state.items.map((item) => {
            if (item.id !== id) return item;

            // Respect max quantity if set
            const newQuantity = item.max_quantity
              ? Math.min(quantity, item.max_quantity)
              : quantity;

            return { ...item, quantity: newQuantity };
          });

          // A quantity change alters the cart total, so an active cart-wide
          // negotiation (one agreed total distributed across lines) no longer
          // holds — reset it instead of applying the old per-unit deal to the
          // new quantity.
          if (state.cartWideNegotiationActive) {
            return {
              items: clearGroupNegotiation(items),
              cartWideNegotiationActive: false,
            };
          }

          return { items };
        });
      },

      // Clear all items
      clearCart: () => {
        set(emptyCheckoutCart());
      },

      // Get specific item
      getItem: (productId, variantId) => {
        return get().items.find(
          (item) =>
            item.product_id === productId && item.variant_id === variantId
        );
      },

      // Apply negotiated price to item (matches web feature parity).
      // This is an individual-line negotiation, so the group flag is cleared —
      // and if a cart-wide deal was active, the other lines' proportional group
      // prices are cleared first so only the freshly negotiated line keeps one.
      applyNegotiatedPrice: (id, negotiatedPrice) => {
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

      // Apply negotiation to the whole cart (matches web behavior)
      applyCartWideNegotiation: (newTotal) => {
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

      // Clear negotiated price from item
      clearNegotiatedPrice: (id) => {
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

      // Restore items directly (for rollback without generating new IDs).
      // When a snapshot of the cart-wide flag is provided, restore it too so a
      // rolled-back group deal keeps its lines and active flag in sync.
      restoreItems: (items, cartWideNegotiationActive, checkoutGeneration) => {
        set({
          items,
          ...(cartWideNegotiationActive !== undefined && {
            cartWideNegotiationActive,
          }),
          ...(checkoutGeneration !== undefined && { checkoutGeneration }),
        });
      },

      // Reconcile line prices from live catalog values keyed by cart line id.
      // When a base price actually changes, any prior negotiation was made
      // against a stale basis and would be rejected at checkout, so it is
      // cleared — the shopper re-negotiates against the current price.
      // Reconcile line prices from live catalog values (see applyReprice):
      // honors the ±₦1 tolerance and resets any active cart-wide group deal.
      repriceItems: (priceById) => {
        set((state) => applyReprice(state, priceById));
      },

      // Toggle device assurance for item
      // Only stores a boolean flag; the actual fee is computed at checkout
      // using the item's current effective price (negotiatedPrice ?? price).
      toggleAssurance: (id) => {
        set((state) => ({
          items: state.items.map((item) =>
            item.id === id
              ? {
                  ...item,
                  hasAssurance: !item.hasAssurance,
                }
              : item
          ),
        }));
      },
    }),
    {
      name: 'cart-storage',
      storage: createJSONStorage(() => syncStorage),
      partialize: (state) => ({
        items: state.items,
        lineSequence: state.lineSequence,
        checkoutGeneration: state.checkoutGeneration,
        cartWideNegotiationActive: state.cartWideNegotiationActive,
      }),
    }
  )
);
