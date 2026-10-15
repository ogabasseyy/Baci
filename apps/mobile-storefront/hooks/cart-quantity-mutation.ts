import type { QueryClient } from '@tanstack/react-query';
import { type CartItem, useCartStore } from '@/stores/cart-store';
import { showCartToast } from './cart-notifications';
import { getCachedOptionStock } from './cart-query-cache';
import { checkStock, getExistingProductQuantityForStock } from './cart-stock';

/**
 * Quantity-update mutation options for the optimistic cart.
 *
 * Split out of use-cart.ts (module size guard): validates the new
 * quantity against live stock with an optimistic store write and a
 * line-scoped rollback that never clobbers a newer concurrent edit.
 */
export interface UpdateQuantityVariables {
  id: string;
  quantity: number;
}

export interface UpdateQuantityResult {
  id: string;
  quantity: number;
  stockCheck: Awaited<ReturnType<typeof checkStock>>;
}

export interface UpdateQuantityContext {
  id: string;
  attemptedQuantity: number;
  /**
   * Actual post-write quantity: the store clamps through max_quantity,
   * so the staleness guard must compare against this, not the request.
   */
  appliedQuantity: number | undefined;
  previousQuantity: number | undefined;
  /** Pre-write per-line snapshot for a guarded negotiation restore. */
  previousItems: CartItem[];
  previousNegotiationActive: boolean;
  /** Post-write flag, to detect concurrent flag writers on rollback. */
  appliedNegotiationActive: boolean;
}

export interface UpdateQuantityMutationDeps {
  queryClient: QueryClient;
  updateQuantityInStore: (id: string, quantity: number) => unknown;
  restoreItemsInStore: (
    items: CartItem[],
    cartWideNegotiationActive: boolean
  ) => unknown;
}

export function createUpdateQuantityMutation({
  queryClient,
  updateQuantityInStore,
  restoreItemsInStore,
}: UpdateQuantityMutationDeps) {
  return {
    mutationFn: async ({
      id,
      quantity,
    }: UpdateQuantityVariables): Promise<UpdateQuantityResult> => {
      // H21 fix: Read fresh items from store instead of stale closure variable
      const freshItems = useCartStore.getState().items;
      const item = freshItems.find((i) => i.id === id);
      if (!item) throw new Error('Item not found');

      // Validate stock for the new quantity, with cached fallback for
      // offline. onMutate already applied the new quantity to the store,
      // so the product aggregate below is the post-update total strict
      // sibling caps need.
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

      return { id, quantity, stockCheck };
    },

    onMutate: ({
      id,
      quantity,
    }: UpdateQuantityVariables): UpdateQuantityContext => {
      // Read fresh from store to avoid stale closure
      const preState = useCartStore.getState();
      const previousQuantity = preState.items.find(
        (i) => i.id === id
      )?.quantity;
      const previousItems = preState.items;
      const previousNegotiationActive = preState.cartWideNegotiationActive;

      // Optimistically update quantity
      updateQuantityInStore(id, quantity);

      // Capture the actual post-write state: the store clamps through
      // max_quantity and clears group negotiation, so the rollback
      // guard and restore must key off these, not the request.
      const postState = useCartStore.getState();
      return {
        id,
        attemptedQuantity: quantity,
        appliedQuantity: postState.items.find((i) => i.id === id)?.quantity,
        previousQuantity,
        previousItems,
        previousNegotiationActive,
        appliedNegotiationActive: postState.cartWideNegotiationActive,
      };
    },

    onError: (
      _error: Error,
      _variables: UpdateQuantityVariables,
      context: UpdateQuantityContext | undefined
    ) => {
      // A stale failure must not clobber a newer edit: rapid keystroke
      // edits queue concurrent validations, so restore this line only
      // when its quantity is still the one this mutation wrote (the
      // clamp-aware applied quantity, not the requested one). A missing
      // line (removed concurrently, or our own optimistic removal) is
      // left alone, never resurrected from a whole-cart snapshot.
      if (context?.id != null && context?.previousQuantity != null) {
        const state = useCartStore.getState();
        const current = state.items.find((i) => i.id === context.id);
        const previousQuantity = context.previousQuantity;
        if (current && current.quantity === context.appliedQuantity) {
          const previousById = new Map(
            context.previousItems.map((item) => [item.id, item])
          );
          const restored = state.items.map((item) => {
            const previous = previousById.get(item.id);
            // Concurrently added lines have no snapshot: preserve them.
            if (!previous) return item;
            if (item.id === context.id) {
              return {
                ...item,
                quantity: previousQuantity,
                negotiatedPrice: previous.negotiatedPrice,
                negotiationStatus: previous.negotiationStatus,
              };
            }
            // Our write may have stripped sibling group negotiation;
            // restore it only when the sibling itself is untouched.
            if (
              item.quantity !== previous.quantity ||
              (item.negotiatedPrice === previous.negotiatedPrice &&
                item.negotiationStatus === previous.negotiationStatus)
            ) {
              return item;
            }
            return {
              ...item,
              negotiatedPrice: previous.negotiatedPrice,
              negotiationStatus: previous.negotiationStatus,
            };
          });
          // Restore the flag only when untouched since our write — a
          // concurrent negotiation change wins over the rollback.
          const flag =
            state.cartWideNegotiationActive === context.appliedNegotiationActive
              ? context.previousNegotiationActive
              : state.cartWideNegotiationActive;
          restoreItemsInStore(restored, flag);
        }
      }
      showCartToast(
        'Stock Error: Quantity adjusted to available stock',
        'error'
      );
    },

    onSuccess: (data: UpdateQuantityResult) => {
      // Bug #96 fix: Read fresh items from store instead of stale closure
      const freshItems = useCartStore.getState().items;
      const item = freshItems.find((i) => i.id === data.id);
      if (item) {
        queryClient.invalidateQueries({
          queryKey: ['product', item.product_id],
        });
      }
    },
  };
}
