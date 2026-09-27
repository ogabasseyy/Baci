import { clearPersistedCheckoutGeneration } from '@/lib/clear-persisted-checkout-generation';
import { createLogger } from '@/lib/logger';
import { persistCheckoutGeneration } from '@/lib/persist-checkout-generation';
import { releaseCheckoutCreditSnapshot } from '@/lib/release-checkout-credit-snapshot';
import { releaseCodepointCheckoutItemSort } from '@/lib/release-codepoint-checkout-item-sort';
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
    // The independent releases run concurrently so a slow store delays
    // post-payment navigation only once instead of once per key.
    const [creditRelease, markerRelease] = await Promise.allSettled([
      withCheckoutStorageTimeout(
        releaseCheckoutCreditSnapshot(options.previousGeneration)
      ),
      withCheckoutStorageTimeout(
        releaseCodepointCheckoutItemSort(options.previousGeneration)
      ),
    ]);
    if (creditRelease.status === 'rejected') {
      log.error(
        'Failed to release checkout credit snapshot:',
        creditRelease.reason
      );
    }
    if (markerRelease.status === 'rejected') {
      log.error(
        'Failed to release checkout sort marker:',
        markerRelease.reason
      );
    }
  }
  return next;
}
