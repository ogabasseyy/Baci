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
import { showCartToast } from './cart-notifications';
import { getCachedOptionStock } from './cart-query-cache';
import {
  type AddToCartInput,
  checkStock,
  getExistingCartQuantityForStock,
} from './cart-stock';

/**
 * Main hook for optimistic cart operations
 */
export function useCart() {
  const queryClient = useQueryClient();

  // Get store actions
  const {
    items,
    addItem: addItemToStore,
    removeItem: removeItemFromStore,
    updateQuantity: updateQuantityInStore,
    itemCount,
    subtotal,
    getItem,
    clearCart,
  } = useCartStore(
    useShallow((state) => ({
      items: state.items,
      addItem: state.addItem,
      removeItem: state.removeItem,
      updateQuantity: state.updateQuantity,
      itemCount: state.itemCount,
      subtotal: state.subtotal,
      getItem: state.getItem,
      clearCart: state.clearCart,
    }))
  );

  // Track pending operations for rollback
  const pendingRollbacks = useRef<Map<string, () => void>>(new Map());

  /** L11 fix: Evict oldest rollback entries to prevent memory leak under rapid mutation spam */
  function trackRollback(id: string, fn: () => void) {
    const map = pendingRollbacks.current;
    // Keep at most 50 pending rollbacks
    if (map.size >= 50) {
      const oldestKey = map.keys().next().value;
      if (oldestKey !== undefined) {
        map.delete(oldestKey);
      }
    }
    map.set(id, fn);
  }

  /**
   * Add to cart with optimistic update and stock validation
   */
  const addToCartMutation = useMutation({
    mutationFn: async (item: AddToCartInput) => {
      // onMutate already applied this line to the store, so the store
      // total IS the requested total; adding the incoming quantity again
      // would double-count the optimistic line.
      const totalQuantity = getExistingCartQuantityForStock(item);

      // Validate stock in background, with cached fallback for offline
      const stockCheck = await checkStock(
        item.product_id,
        totalQuantity,
        getCachedOptionStock(queryClient, item.product_id, {
          variantId: item.variant_id ?? null,
          offerId: item.offer_id ?? null,
        }),
        {
          variantId: item.variant_id ?? null,
          offerId: item.offer_id ?? null,
        }
      );

      if (!stockCheck.available) {
        throw new Error(
          `Only ${stockCheck.currentStock} items available in stock`
        );
      }

      return { item, stockCheck };
    },

    // Optimistic update - runs immediately before mutationFn
    onMutate: (item) => {
      // Generate a temporary ID for potential rollback
      const rollbackId = `${item.product_id}-${item.variant_id || 'default'}-${Date.now()}`;

      // Capture current state for rollback (read fresh from store to avoid stale closure)
      const previousItems = [...useCartStore.getState().items];

      // Optimistically add to cart (instant UI update)
      addItemToStore(item);

      // Store rollback function (L11 fix: uses trackRollback to enforce size limit)
      trackRollback(rollbackId, () => {
        // Restore previous state
        useCartStore.setState({ items: previousItems });
      });

      return { rollbackId, previousItems };
    },

    // On error, rollback the optimistic update
    onError: (error, _item, context) => {
      if (context?.rollbackId) {
        const rollback = pendingRollbacks.current.get(context.rollbackId);
        if (rollback) {
          rollback();
          pendingRollbacks.current.delete(context.rollbackId);
        }
      }

      // Show stock error toast
      showCartToast(
        error instanceof Error ? error.message : 'Failed to add to cart',
        'error'
      );
    },

    // Cleanup on success
    onSuccess: (data, _item, context) => {
      if (context?.rollbackId) {
        pendingRollbacks.current.delete(context.rollbackId);
      }

      // Invalidate specific product query to refresh stock data
      queryClient.invalidateQueries({
        queryKey: ['product', data.item.product_id],
      });
    },
  });

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
        useCartStore.setState({ items: context.previousItems });
      }
      showCartToast('Failed to remove item', 'error');
    },
  });

  /**
   * Update quantity with optimistic update and stock validation
   */
  const updateQuantityMutation = useMutation({
    mutationFn: async ({ id, quantity }: { id: string; quantity: number }) => {
      // H21 fix: Read fresh items from store instead of stale closure variable
      const freshItems = useCartStore.getState().items;
      const item = freshItems.find((i) => i.id === id);
      if (!item) throw new Error('Item not found');

      // Validate stock for the new quantity, with cached fallback for offline
      const stockCheck = await checkStock(
        item.product_id,
        quantity,
        getCachedOptionStock(queryClient, item.product_id, {
          variantId: item.variant_id ?? null,
          offerId: item.offer_id ?? null,
        }),
        {
          variantId: item.variant_id ?? null,
          offerId: item.offer_id ?? null,
        }
      );

      if (!stockCheck.available) {
        throw new Error(
          `Only ${stockCheck.currentStock} items available in stock`
        );
      }

      return { id, quantity, stockCheck };
    },

    onMutate: ({ id, quantity }) => {
      // Read fresh from store to avoid stale closure
      const previousItems = [...useCartStore.getState().items];

      // Optimistically update quantity
      updateQuantityInStore(id, quantity);

      return { previousItems };
    },

    onError: (_error, _, context) => {
      if (context?.previousItems) {
        useCartStore.setState({ items: context.previousItems });
      }
      showCartToast(
        'Stock Error: Quantity adjusted to available stock',
        'error'
      );
    },

    onSuccess: (data) => {
      // Bug #96 fix: Read fresh items from store instead of stale closure
      const freshItems = useCartStore.getState().items;
      const item = freshItems.find((i) => i.id === data.id);
      if (item) {
        queryClient.invalidateQueries({
          queryKey: ['product', item.product_id],
        });
      }
    },
  });

  // Wrapped functions for easier consumption
  const addToCart = (item: AddToCartInput) => {
    addToCartMutation.mutate(item);
  };

  const removeFromCart = (id: string) => {
    removeFromCartMutation.mutate(id);
  };

  const updateQuantity = (id: string, quantity: number) => {
    updateQuantityMutation.mutate({ id, quantity });
  };

  return {
    // State
    items,
    itemCount: itemCount(),
    subtotal: subtotal(),

    // Optimistic actions
    addToCart,
    removeFromCart,
    updateQuantity,

    // Mutation states for UI feedback
    isAddingToCart: addToCartMutation.isPending,
    isRemovingFromCart: removeFromCartMutation.isPending,
    isUpdatingQuantity: updateQuantityMutation.isPending,

    // Direct store access for non-optimistic operations
    getItem,
    clearCart,
  };
}
