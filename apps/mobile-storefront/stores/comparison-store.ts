/**
 * Product Comparison Store using Zustand
 * Manages products selected for comparison (max 3)
 */

import { create } from 'zustand';
import type { Product } from '../types/product';

const MAX_COMPARE_ITEMS = 3;

interface ComparisonState {
  // State
  products: Product[];

  // Computed (via getters)
  count: () => number;
  canAdd: () => boolean;

  // Actions
  addProduct: (product: Product) => boolean;
  removeProduct: (productId: string) => void;
  isInComparison: (productId: string) => boolean;
  clearComparison: () => void;
  toggleComparison: (product: Product) => boolean;
}

/** Comparison lives only in this app process; a fresh launch starts empty. */
export const createComparisonStore = () =>
  create<ComparisonState>()((set, get) => ({
    // Initial state
    products: [],

    // Computed values
    count: () => get().products.length,

    canAdd: () => get().products.length < MAX_COMPARE_ITEMS,

    // Add product to comparison
    addProduct: (product) => {
      const state = get();

      // Check if already in comparison
      if (state.products.some((p) => String(p.id) === String(product.id))) {
        return false;
      }

      // Check if max reached
      if (state.products.length >= MAX_COMPARE_ITEMS) {
        return false;
      }

      set({ products: [...state.products, product] });
      return true;
    },

    // Remove product from comparison
    removeProduct: (productId) => {
      set((state) => ({
        products: state.products.filter(
          (p) => String(p.id) !== String(productId)
        ),
      }));
    },

    // Check if product is in comparison
    isInComparison: (productId) => {
      return get().products.some((p) => String(p.id) === String(productId));
    },

    // Clear all products from comparison
    clearComparison: () => {
      set({ products: [] });
    },

    // Toggle product in comparison
    toggleComparison: (product) => {
      const state = get();
      const isIn = state.products.some(
        (p) => String(p.id) === String(product.id)
      );

      if (isIn) {
        set({
          products: state.products.filter(
            (p) => String(p.id) !== String(product.id)
          ),
        });
        return false;
      }

      if (state.products.length >= MAX_COMPARE_ITEMS) {
        return false;
      }

      set({ products: [...state.products, product] });
      return true;
    },
  }));

export const useComparisonStore = createComparisonStore();
