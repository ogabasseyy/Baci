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
import { isSameCartLine } from '@/stores/cart-line';
import { useCartStore } from '@/stores/cart-store';
import { hasSharedCartWriter } from '@/stores/shared-cart-writer';
import { showCartToast } from './cart-notifications';
import { createUpdateQuantityMutation } from './cart-quantity-mutation';
import { getCachedOptionStock } from './cart-query-cache';
import {
  type AddToCartInput,
  checkStock,
  getExistingCartQuantityForStock,
  getExistingProductQuantityForStock,
} from './cart-stock';

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

      // Validate stock in background, with cached fallback for offline.
      // The store already holds the optimistic line, so the product
      // aggregate below is the post-add total strict sibling caps need.
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
          aggregateQuantity: getExistingProductQuantityForStock(
            item.product_id
          ),
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
      const rollbackId = `${item.product_id}-${item.variant_id || 'default'}-${Date.now()}-${rollbackSequence.current++}`;

      // Capture current state for rollback (read fresh from store to avoid stale closure)
      const previousItems = [...useCartStore.getState().items];
      const previousLine = previousItems.find((line) =>
        isSameCartLine(line, item)
      );

      // Optimistically add to cart (instant UI update)
      addItemToStore(item);
      const addedLine = useCartStore
        .getState()
        .items.find((line) => isSameCartLine(line, item));

      // Store rollback function (L11 fix: uses trackRollback to enforce size limit).
      // Contribution-scoped: a failed add subtracts exactly the units
      // it wrote — never a whole-cart snapshot — so a concurrent
      // successful add to the same line survives a sibling's stock
      // failure, and a clamped later add is never rolled back with it.
      // Measured post-write so max_quantity clamping is honored.
      const previousQuantity = previousLine?.quantity ?? 0;
      const contributedQuantity = addedLine
        ? Math.max(0, addedLine.quantity - previousQuantity)
        : 0;
      trackRollback(rollbackId, () => {
        if (!addedLine) {
          return;
        }
        // A shared-cart writer owns the lines: the legacy rollback must
        // not edit the parked cart.
        if (hasSharedCartWriter()) {
          return;
        }
        useCartStore.setState((state) => {
          const current = state.items.find((i) => i.id === addedLine.id);
          // Concurrently removed: leave alone, never resurrect.
          if (!current) {
            return state;
          }
          const rolledBackQuantity = current.quantity - contributedQuantity;
          // The line now holds less than we wrote: another writer
          // (removal, explicit quantity set) already consumed our
          // contribution, so there is nothing left to remove.
          if (rolledBackQuantity < 0) {
            return state;
          }
          if (rolledBackQuantity === 0) {
            return {
              items: state.items.filter((i) => i.id !== addedLine.id),
            };
          }
          return {
            items: state.items.map((i) =>
              i.id === addedLine.id ? { ...i, quantity: rolledBackQuantity } : i
            ),
          };
        });
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
