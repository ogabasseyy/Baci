import type { QueryClient } from '@tanstack/react-query';
import { useCartStore } from '@/stores/cart-store';
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
  previousQuantity: number | undefined;
}

export interface UpdateQuantityMutationDeps {
  queryClient: QueryClient;
  updateQuantityInStore: (id: string, quantity: number) => unknown;
}

export function createUpdateQuantityMutation({
  queryClient,
  updateQuantityInStore,
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
      const previousQuantity = useCartStore
        .getState()
        .items.find((i) => i.id === id)?.quantity;

      // Optimistically update quantity
      updateQuantityInStore(id, quantity);

      return { id, attemptedQuantity: quantity, previousQuantity };
    },

    onError: (
      _error: Error,
      _variables: UpdateQuantityVariables,
      context: UpdateQuantityContext | undefined
    ) => {
      // A stale failure must not clobber a newer edit: rapid keystroke
      // edits queue concurrent validations, so restore this line only
      // when its quantity is still the one this mutation attempted.
      // A missing line (removed concurrently) is left alone, never
      // resurrected from a whole-cart snapshot.
      if (context?.id != null && context?.previousQuantity != null) {
        const current = useCartStore
          .getState()
          .items.find((i) => i.id === context.id);
        if (current && current.quantity === context.attemptedQuantity) {
          updateQuantityInStore(context.id, context.previousQuantity);
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
