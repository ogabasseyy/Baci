import * as Crypto from 'expo-crypto';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { createLogger } from '@/lib/logger';
import { persistCheckoutGeneration } from '@/lib/persist-checkout-generation';
import { syncStorage } from '../lib/storage';
import { applyPersistedCheckoutGeneration } from './apply-persisted-checkout-generation';
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
import { partializeCartStore } from './partialize-cart-store';
import { rotateEmptyCheckoutCart } from './rotate-empty-checkout-cart';

export type { CartItem } from './cart-store.types';
export { formatPrice, selectCartQuantities };

const log = createLogger('CartStore');

export function resetCartLineSequence() {
  if (useCartStore.getState().items.length === 0) {
    useCartStore.setState({ lineSequence: 0 });
  }
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      isLoading: false,
      lineSequence: 0,
      checkoutGeneration: 'legacy',
      cartWideNegotiationActive: false,

      itemCount: () => {
        return get().items.reduce((total, item) => total + item.quantity, 0);
      },

      subtotal: () => {
        return get().items.reduce((total, item) => {
          const effectivePrice = item.negotiatedPrice ?? item.price;
          return total + effectivePrice * item.quantity;
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

      addItem: (item) => {
        set((state) => {
          const itemToAdd =
            item.voucher_token || item.voucher_award_id
              ? { ...item, quantity: 1 }
              : item;

          const existingIndex = state.items.findIndex((existingItem) =>
            isSameCartLine(existingItem, itemToAdd)
          );

          const checkoutGeneration =
            state.items.length === 0
              ? state.checkoutGeneration === 'legacy'
                ? Crypto.randomUUID()
                : state.checkoutGeneration
              : state.checkoutGeneration;
          if (state.items.length === 0) {
            void persistCheckoutGeneration(checkoutGeneration);
          }
          let items: CartItem[];
          let lineSequence = state.lineSequence;
          if (existingIndex >= 0) {
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

      removeItem: async (id) => {
        const state = get();
        const items = state.items.filter((item) => item.id !== id);
        if (items.length === 0) {
          await rotateEmptyCheckoutCart(set);
          return;
        }
        if (state.cartWideNegotiationActive) {
          set({
            items: clearGroupNegotiation(items),
            cartWideNegotiationActive: false,
          });
          return;
        }
        set({ items });
      },

      updateQuantity: async (id, quantity) => {
        const state = get();
        if (quantity <= 0) {
          const items = state.items.filter((item) => item.id !== id);
          if (items.length === 0) {
            await rotateEmptyCheckoutCart(set);
            return;
          }
          if (state.cartWideNegotiationActive) {
            set({
              items: clearGroupNegotiation(items),
              cartWideNegotiationActive: false,
            });
            return;
          }
          set({ items });
          return;
        }

        const items = state.items.map((item) => {
          if (item.id !== id) return item;
          const newQuantity = item.max_quantity
            ? Math.min(quantity, item.max_quantity)
            : quantity;
          return { ...item, quantity: newQuantity };
        });

        if (state.cartWideNegotiationActive) {
          set({
            items: clearGroupNegotiation(items),
            cartWideNegotiationActive: false,
          });
          return;
        }
        set({ items });
      },

      clearCart: async () => {
        await rotateEmptyCheckoutCart(set);
      },

      getItem: (productId, variantId) => {
        return get().items.find(
          (item) =>
            item.product_id === productId && item.variant_id === variantId
        );
      },

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

      advanceCheckoutGeneration: async () => {
        const checkoutGeneration = Crypto.randomUUID();
        await persistCheckoutGeneration(checkoutGeneration);
        set({ checkoutGeneration });
      },
      restoreItems: async (
        items,
        cartWideNegotiationActive,
        checkoutGeneration
      ) => {
        set({
          items,
          ...(cartWideNegotiationActive !== undefined && {
            cartWideNegotiationActive,
          }),
          ...(checkoutGeneration !== undefined && { checkoutGeneration }),
        });
        if (checkoutGeneration !== undefined) {
          try {
            await persistCheckoutGeneration(checkoutGeneration);
          } catch (error) {
            log.error('Failed to persist restored checkout generation:', error);
          }
        }
      },

      repriceItems: (priceById) => {
        set((state) => applyReprice(state, priceById));
      },

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
      partialize: partializeCartStore,
      onRehydrateStorage: () => () => {
        void applyPersistedCheckoutGeneration((checkoutGeneration) => {
          useCartStore.setState({ checkoutGeneration });
        });
      },
    }
  )
);
