import { releaseCheckoutCreditSnapshot } from '@/lib/checkout-attempt-credit-snapshot';
import { releaseCodepointCheckoutItemSort } from '@/lib/checkout-idempotency-item-sort';
import { clearPersistedCheckoutGeneration } from '@/lib/clear-persisted-checkout-generation';
import { createLogger } from '@/lib/logger';
import { persistCheckoutGeneration } from '@/lib/persist-checkout-generation';
import { withCheckoutStorageTimeout } from '@/lib/with-checkout-storage-timeout';
import { emptyCheckoutCart } from './empty-checkout-cart';

const log = createLogger('CartStore');

export type RotateEmptyCheckoutCartOptions = {
  previousGeneration?: string;
  retainCreditSnapshot?: boolean;
};

export async function rotateEmptyCheckoutCart(
  apply: (next: ReturnType<typeof emptyCheckoutCart>) => void,
  options?: RotateEmptyCheckoutCartOptions
) {
  const next = emptyCheckoutCart();
  apply(next);
  const persistAttempt = persistCheckoutGeneration(next.checkoutGeneration);
  try {
    await withCheckoutStorageTimeout(persistAttempt);
  } catch (error) {
    log.error('Failed to persist empty-cart checkout generation:', error);
    try {
      await withCheckoutStorageTimeout(clearPersistedCheckoutGeneration());
    } catch (clearError) {
      log.error(
        'Failed to clear stale checkout generation after persist rejection:',
        clearError
      );
    }
  }
  // Snapshot cleanup runs after the rotated generation is durable so a slow
  // credit-map read cannot leave the previous purchase identity restorable.
  // The sort marker shares that lifecycle: it is pruned alongside the
  // snapshot so completed carts leave no residue behind.
  if (options?.previousGeneration && options.retainCreditSnapshot !== true) {
    try {
      await withCheckoutStorageTimeout(
        releaseCheckoutCreditSnapshot(options.previousGeneration)
      );
    } catch (error) {
      log.error('Failed to release checkout credit snapshot:', error);
    }
    try {
      await withCheckoutStorageTimeout(
        releaseCodepointCheckoutItemSort(options.previousGeneration)
      );
    } catch (error) {
      log.error('Failed to release checkout sort marker:', error);
    }
  }
  return next;
}
