import { releaseCheckoutCreditSnapshot } from '@/lib/checkout-attempt-credit-snapshot';
import {
  clearPersistedCheckoutGeneration,
  removeAbandonedCheckoutGenerationWrite,
} from '@/lib/clear-persisted-checkout-generation';
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
    // If the abandoned write eventually lands, invalidate what it wrote so
    // a slow persist can never restore a stale generation behind us.
    void persistAttempt.then(
      () =>
        removeAbandonedCheckoutGenerationWrite(next.checkoutGeneration).catch(
          () => undefined
        ),
      () => undefined
    );
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
  if (options?.previousGeneration && options.retainCreditSnapshot !== true) {
    try {
      await withCheckoutStorageTimeout(
        releaseCheckoutCreditSnapshot(options.previousGeneration)
      );
    } catch (error) {
      log.error('Failed to release checkout credit snapshot:', error);
    }
  }
  return next;
}
