import type { QueryClient } from '@tanstack/react-query';
import type { MutableRefObject } from 'react';
import { isSameCartLine } from '@/stores/cart-line';
import { type CartItem, useCartStore } from '@/stores/cart-store';
import { hasSharedCartWriter } from '@/stores/shared-cart-writer';
import { showCartToast } from './cart-notifications';
import { getCachedOptionStock } from './cart-query-cache';
import {
  type AddToCartInput,
  checkStock,
  getExistingCartQuantityForStock,
  getExistingProductQuantityForStock,
} from './cart-stock';

/**
 * Add-to-cart mutation options for the optimistic cart.
 *
 * Split out of use-cart.ts (module size guard): validates the
 * post-write identity total against live stock with an optimistic
 * store write and a contribution-scoped rollback that subtracts
 * exactly the units this add wrote.
 */
export interface AddToCartResult {
  item: AddToCartInput;
  stockCheck: Awaited<ReturnType<typeof checkStock>>;
}

export interface AddToCartContext {
  rollbackId: string;
  previousItems: CartItem[];
}

export interface AddToCartMutationDeps {
  queryClient: QueryClient;
  addItemToStore: (item: AddToCartInput) => unknown;
  pendingRollbacks: MutableRefObject<Map<string, () => void>>;
  rollbackSequence: MutableRefObject<number>;
}

export function createAddToCartMutation({
  queryClient,
  addItemToStore,
  pendingRollbacks,
  rollbackSequence,
}: AddToCartMutationDeps) {
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

  return {
    mutationFn: async (item: AddToCartInput): Promise<AddToCartResult> => {
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
    onMutate: (item: AddToCartInput): AddToCartContext => {
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
    onError: (
      error: Error,
      _item: AddToCartInput,
      context: AddToCartContext | undefined
    ) => {
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
    onSuccess: (
      data: AddToCartResult,
      _item: AddToCartInput,
      context: AddToCartContext | undefined
    ) => {
      if (context?.rollbackId) {
        pendingRollbacks.current.delete(context.rollbackId);
      }

      // Invalidate specific product query to refresh stock data
      queryClient.invalidateQueries({
        queryKey: ['product', data.item.product_id],
      });
    },
  };
}
