import { applyCheckoutCreditSnapshot } from '@/lib/checkout-attempt-credit-snapshot';
import { createLogger } from '@/lib/logger';
import { markCodepointCheckoutItemSort } from '@/lib/mark-codepoint-checkout-item-sort';
import { mintedCheckoutGenerations } from '@/lib/minted-checkout-generations';
import { withCheckoutStorageTimeout } from '@/lib/with-checkout-storage-timeout';
import { useCartStore } from '@/stores/cart-store';
import type { CartItem } from '@/stores/cart-store.types';

const log = createLogger('Checkout');

/**
 * Restores the checkout snapshot when a failed submit emptied the cart.
 * Best-effort: restore failures never mask the original submit error.
 */
export async function restoreEmptiedCheckoutCart({
  cartWideNegotiationActive,
  checkoutGeneration,
  creditFields,
  hadSortMarker,
  itemsSnapshot,
}: {
  cartWideNegotiationActive: boolean;
  checkoutGeneration: string;
  creditFields?: Record<string, unknown>;
  hadSortMarker?: boolean;
  itemsSnapshot: CartItem[];
}): Promise<void> {
  const cartStore = useCartStore.getState();
  if (cartStore.items.length !== 0) {
    return;
  }
  try {
    await cartStore.restoreItems(
      itemsSnapshot,
      cartWideNegotiationActive,
      checkoutGeneration
    );
  } catch (restoreError) {
    void restoreError;
    return;
  }
  if (!creditFields) {
    return;
  }
  // The clear path released this generation's frozen credit snapshot and
  // sort marker. Re-freeze both under the restored generation so a retry
  // replays the created order instead of hashing fresh credit under a
  // forked idempotency key. The marker is restored only when it existed
  // before cleanup: a legacy generation was keyed with locale ordering,
  // and marking it now would fork its key on retry. When the pre-cleanup
  // state could not be captured, the minted registry covers the
  // same-process case (it is empty after a restart, so restored current
  // generations must pass their captured state). The marker write is
  // bounded (the snapshot apply already times out internally) so a hung
  // store cannot latch checkout recovery forever.
  try {
    await applyCheckoutCreditSnapshot(creditFields, checkoutGeneration);
    const shouldRestoreMarker =
      hadSortMarker ??
      mintedCheckoutGenerations.isRegistered(checkoutGeneration);
    if (shouldRestoreMarker) {
      await withCheckoutStorageTimeout(
        markCodepointCheckoutItemSort(checkoutGeneration)
      );
    }
  } catch (recoveryError) {
    log.error(
      'Failed to restore checkout recovery data after cart rollback:',
      recoveryError
    );
  }
}
