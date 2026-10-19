/**
 * Optimistic Cart Hook - 2026 Best Practice
 *
 * Features:
 * - Immediate UI feedback (< 16ms reaction time)
 * - Automatic rollback on stock validation failure
 * - Toast notifications for stock errors
 * - Syncs with Zustand cart store
 * - Network awareness before mutations (2026 Best Practice)
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useCartStore } from '@/stores/cart-store';
import { hasSharedCartWriter } from '@/stores/shared-cart-writer';
import { createAddToCartMutation } from './cart-add-mutation';
import { showCartToast } from './cart-notifications';
import { createUpdateQuantityMutation } from './cart-quantity-mutation';
import type { AddToCartInput } from './cart-stock';

/**
 * Main hook for optimistic cart operations
 */
export function useCart() {
  const queryClient = useQueryClient();

  // Get store actions
  const {
    items,
    isLoading,
    addItem: addItemToStore,
    removeItem: removeItemFromStore,
    updateQuantity: updateQuantityInStore,
    restoreItems: restoreItemsInStore,
    itemCount,
    subtotal,
    getItem,
    clearCart,
  } = useCartStore(
    useShallow((state) => ({
      items: state.items,
      isLoading: state.isLoading,
      addItem: state.addItem,
      removeItem: state.removeItem,
      updateQuantity: state.updateQuantity,
      restoreItems: state.restoreItems,
      itemCount: state.itemCount,
      subtotal: state.subtotal,
      getItem: state.getItem,
      clearCart: state.clearCart,
    }))
  );

  // Track pending operations for rollback
  const pendingRollbacks = useRef<Map<string, () => void>>(new Map());
  // Monotonic rollback sequence: Date.now() alone can collide for two
  // rapid adds in the same millisecond, so the sequence keeps every
  // pending entry addressable even when timestamps match.
  const rollbackSequence = useRef(0);

  /**
   * Add to cart with optimistic update and stock validation
   */
  const addToCartMutation = useMutation(
    createAddToCartMutation({
      queryClient,
      addItemToStore,
      pendingRollbacks,
      rollbackSequence,
    })
  );

  /**
   * Remove from cart with optimistic update
   */
  const removeFromCartMutation = useMutation({
    // biome-ignore lint/suspicious/useAwait: react-query's MutationFunction type requires a Promise-returning function
    mutationFn: async (id: string) => {
      // No backend validation needed for removal
      return { id };
    },

    onMutate: (id) => {
      // Read fresh from store to avoid stale closure
      const freshItems = useCartStore.getState().items;
      const previousItems = [...freshItems];
      const removedItem = freshItems.find((i) => i.id === id);

      // Optimistically remove from cart
      removeItemFromStore(id);

      return { previousItems, removedItem };
    },

    onError: (_error, _id, context) => {
      if (context?.previousItems) {
        if (!hasSharedCartWriter())
          useCartStore.setState({ items: context.previousItems });
      }
      showCartToast('Failed to remove item', 'error');
    },
  });

  /**
   * Update quantity with optimistic update and stock validation
   */
  const updateQuantityMutation = useMutation(
    createUpdateQuantityMutation({
      queryClient,
      updateQuantityInStore,
      restoreItemsInStore,
    })
  );

  // Wrapped functions for easier consumption
  const addToCart = (item: AddToCartInput) => {
    if (hasSharedCartWriter()) {
      addItemToStore(item);
      return;
    }
    addToCartMutation.mutate(item);
  };

  // Promise variant for callers that must gate success-only behavior
  // (analytics, confirmation toasts) on validation succeeding: the
  // fire-and-forget wrapper above cannot report a stock rejection.
  const addToCartAsync = (item: AddToCartInput) => {
    return addToCartMutation.mutateAsync(item);
  };

  const removeFromCart = (id: string) => {
    if (hasSharedCartWriter()) {
      void removeItemFromStore(id);
      return;
    }
    removeFromCartMutation.mutate(id);
  };

  const updateQuantity = (id: string, quantity: number) => {
    if (hasSharedCartWriter()) {
      void updateQuantityInStore(id, quantity);
      return;
    }
    updateQuantityMutation.mutate({ id, quantity });
  };

  return {
    // State
    items,
    itemCount: itemCount(),
    subtotal: subtotal(),

    // Optimistic actions
    addToCart,
    addToCartAsync,
    removeFromCart,
    updateQuantity,

    // Mutation states for UI feedback
    isAddingToCart: hasSharedCartWriter()
      ? isLoading
      : addToCartMutation.isPending,
    isRemovingFromCart: hasSharedCartWriter()
      ? isLoading
      : removeFromCartMutation.isPending,
    isUpdatingQuantity: hasSharedCartWriter()
      ? isLoading
      : updateQuantityMutation.isPending,

    // Direct store access for non-optimistic operations
    getItem,
    clearCart,
  };
}
