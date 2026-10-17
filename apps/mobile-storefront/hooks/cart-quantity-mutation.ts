import type { QueryClient } from '@tanstack/react-query';
import { type CartItem, useCartStore } from '@/stores/cart-store';
import { showCartToast } from './cart-notifications';
import {
  advanceQuantityValidationBaseline,
  beginQuantityValidationFlight,
  endQuantityValidationFlight,
  readQuantityValidationBaseline,
} from './cart-quantity-validation-flights';
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
  /**
   * Post-write per-line snapshot: the rollback restores negotiation
   * only while a line still matches this, so a concurrent negotiation
   * that landed after our write wins over the failed stock request.
   */
  appliedItems: CartItem[];
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
    }: UpdateQuantityVariables): Promise<UpdateQuantityResult> => {
      // H21 fix: Read fresh items from store instead of stale closure variable
      const freshItems = useCartStore.getState().items;
      const item = freshItems.find((i) => i.id === id);
      if (!item) throw new Error('Item not found');

      // Validate the APPLIED quantity, not the raw request: onMutate
      // already clamped the store through max_quantity, and `item` above
      // is the post-write row. Validating the raw input would report a
      // stock error (and roll back) when live stock covers the clamped
      // amount but not the unbounded request.
      const appliedQuantity = item.quantity;
      const stockCheck = await checkStock(
        item.product_id,
        appliedQuantity,
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

      return { id, quantity: appliedQuantity, stockCheck };
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

      // The pre-write quantity is stock-validated (initial store state
      // or a settled success), so it seeds the shared baseline when
      // this edit is the first in flight for the line.
      beginQuantityValidationFlight(id, previousQuantity);

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
        appliedItems: postState.items,
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
      // onSettled runs after this handler and ends the flight, so
      // the entry (and its baseline) is still present here, even for
      // the last settler.
      const validatedBaseline =
        context?.id != null
          ? readQuantityValidationBaseline(context.id)
          : undefined;
      if (context?.id != null && context?.previousQuantity != null) {
        const state = useCartStore.getState();
        const current = state.items.find((i) => i.id === context.id);
        // Restore the last validated baseline, not this edit's own
        // predecessor: with overlapping edits the predecessor was
        // written optimistically and may never have passed stock
        // validation itself.
        const previousQuantity = validatedBaseline ?? context.previousQuantity;
        if (current && current.quantity === context.appliedQuantity) {
          const previousById = new Map(
            context.previousItems.map((item) => [item.id, item])
          );
          const appliedById = new Map(
            context.appliedItems.map((item) => [item.id, item])
          );
          const restored = state.items.map((item) => {
            const previous = previousById.get(item.id);
            // Concurrently added lines have no snapshot: preserve them.
            if (!previous) return item;
            const applied = appliedById.get(item.id);
            // Negotiation restores only while the line still holds
            // exactly what our write left: a concurrent negotiation
            // that landed after us wins over this failed request.
            const negotiationUntouched =
              applied != null &&
              item.negotiatedPrice === applied.negotiatedPrice &&
              item.negotiationStatus === applied.negotiationStatus;
            if (item.id === context.id) {
              return {
                ...item,
                quantity: previousQuantity,
                ...(negotiationUntouched
                  ? {
                      negotiatedPrice: previous.negotiatedPrice,
                      negotiationStatus: previous.negotiationStatus,
                    }
                  : {}),
              };
            }
            // Our write may have stripped sibling group negotiation;
            // restore it only when the sibling itself is untouched
            // since our write and our write actually changed it.
            if (
              item.quantity !== previous.quantity ||
              !negotiationUntouched ||
              (applied?.negotiatedPrice === previous.negotiatedPrice &&
                applied?.negotiationStatus === previous.negotiationStatus)
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
      // This quantity passed stock validation: it becomes the
      // rollback baseline for any still-pending overlapping edit.
      advanceQuantityValidationBaseline(data.id, data.quantity);
      // Bug #96 fix: Read fresh items from store instead of stale closure
      const freshItems = useCartStore.getState().items;
      const item = freshItems.find((i) => i.id === data.id);
      if (item) {
        queryClient.invalidateQueries({
          queryKey: ['product', item.product_id],
        });
      }
    },

    onSettled: (
      _data: UpdateQuantityResult | undefined,
      _error: Error | null,
      variables: UpdateQuantityVariables
    ) => {
      // Exactly-once flight accounting: react-query runs onSettled
      // after onSuccess/onError for every mutation, so successes and
      // failures both decrement here and only here.
      endQuantityValidationFlight(variables.id);
    },
  };
}
