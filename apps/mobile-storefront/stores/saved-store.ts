/**
 * Saved Items (Wishlist) Store using Zustand
 * Manages wishlist state with AsyncStorage persistence
 * Compatible with Expo Go (no native modules required)
 */

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { syncStorage } from '../lib/storage';
import type { Product } from '../types/product';

export interface SavedItem {
  id: string;
  product_id: string;
  name: string;
  slug: string;
  price: number;
  compare_at_price?: number;
  image: string;
  brand?: string;
  condition?: string;
  // Search-match identity for the advertised price/condition basis. Refined
  // search may resolve a non-default variant or condition offer; the PDP
  // re-selects that option from these params so the saved price matches.
  match_variant_id?: string;
  match_offer_id?: string;
  match_condition?: string;
  has_variants?: boolean;
  variant_model?: Product['variant_model'];
  available_conditions?: Product['available_conditions'];
  has_condition_offers?: boolean;
  savedAt: number;
}

interface ToastState {
  show: boolean;
  message: string;
  type: 'add' | 'remove';
}

interface SavedState {
  // State
  items: SavedItem[];
  toastState: ToastState;

  // Computed (via getters)
  itemCount: () => number;

  // Actions
  toggleSaved: (product: Product) => void;
  addItem: (product: Product) => void;
  removeItem: (productId: string) => void;
  isSaved: (productId: string) => boolean;
  clearSaved: () => void;
  dismissToast: () => void;
}

export const useSavedStore = create<SavedState>()(
  persist(
    (set, get) => ({
      // Initial state
      items: [],
      toastState: {
        show: false,
        message: '',
        type: 'add',
      },

      // Computed values
      itemCount: () => {
        return get().items.length;
      },

      // Toggle saved status (add if not saved, remove if saved)
      toggleSaved: (product) => {
        const state = get();
        const exists = state.items.some(
          (item) => String(item.product_id) === String(product.id)
        );

        if (exists) {
          set({
            items: state.items.filter(
              (item) => String(item.product_id) !== String(product.id)
            ),
            toastState: {
              show: true,
              message: 'Removed from Saved',
              type: 'remove',
            },
          });
        } else {
          const newItem: SavedItem = {
            id: `saved-${product.id}-${Date.now()}`,
            product_id: product.id,
            name: product.name,
            slug: product.slug,
            price: product.price,
            compare_at_price: product.compare_at_price,
            image: product.image,
            brand: product.brand,
            condition: product.condition,
            match_variant_id: product.searchMatch?.variantId,
            match_offer_id: product.searchMatch?.offerId,
            match_condition: product.searchMatch?.condition,
            has_variants: product.has_variants,
            variant_model: product.variant_model,
            available_conditions: product.available_conditions,
            has_condition_offers: product.has_condition_offers,
            savedAt: Date.now(),
          };

          set({
            items: [...state.items, newItem],
            toastState: {
              show: true,
              message: 'Added to Saved Items',
              type: 'add',
            },
          });
        }
      },

      // Add item to saved
      addItem: (product) => {
        set((state) => {
          // Check if already saved
          const exists = state.items.some(
            (item) => String(item.product_id) === String(product.id)
          );

          if (exists) {
            return state; // Already saved, don't add again
          }

          const newItem: SavedItem = {
            id: `saved-${product.id}-${Date.now()}`,
            product_id: product.id,
            name: product.name,
            slug: product.slug,
            price: product.price,
            compare_at_price: product.compare_at_price,
            image: product.image,
            brand: product.brand,
            condition: product.condition,
            match_variant_id: product.searchMatch?.variantId,
            match_offer_id: product.searchMatch?.offerId,
            match_condition: product.searchMatch?.condition,
            has_variants: product.has_variants,
            variant_model: product.variant_model,
            available_conditions: product.available_conditions,
            has_condition_offers: product.has_condition_offers,
            savedAt: Date.now(),
          };

          return {
            items: [...state.items, newItem],
            toastState: {
              show: true,
              message: 'Added to Saved Items',
              type: 'add',
            },
          };
        });
      },

      // Remove item from saved
      removeItem: (productId) => {
        set((state) => ({
          items: state.items.filter(
            (item) => String(item.product_id) !== String(productId)
          ),
          toastState: {
            show: true,
            message: 'Removed from Saved',
            type: 'remove',
          },
        }));
      },

      // Check if product is saved
      isSaved: (productId) => {
        return get().items.some(
          (item) => String(item.product_id) === String(productId)
        );
      },

      // Clear all saved items
      clearSaved: () => {
        set({ items: [] });
      },

      // Dismiss toast notification
      dismissToast: () => {
        set((state) => ({
          toastState: { ...state.toastState, show: false },
        }));
      },
    }),
    {
      name: 'saved-storage',
      storage: createJSONStorage(() => syncStorage),
      partialize: (state) => ({ items: state.items }), // Only persist items
    }
  )
);

let cachedSavedItems: SavedItem[] | null = null;
let cachedSavedIds = new Set<string>();

/**
 * Memoized set of saved product ids, rebuilt only when `items` changes. Lets
 * each product card do an O(1) `.has(id)` membership check (returning a boolean
 * primitive) instead of an O(items) `.some()` scan per card — without changing
 * re-render scoping (the selector still returns a primitive).
 */
export function selectSavedProductIds(state: SavedState): ReadonlySet<string> {
  if (state.items !== cachedSavedItems) {
    cachedSavedItems = state.items;
    cachedSavedIds = new Set(
      state.items.map((item) => String(item.product_id))
    );
  }
  return cachedSavedIds;
}
