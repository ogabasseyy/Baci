import { releaseCheckoutCreditSnapshot } from '@/lib/checkout-attempt-credit-snapshot';
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
  if (options?.previousGeneration && options.retainCreditSnapshot !== true) {
    try {
      await releaseCheckoutCreditSnapshot(options.previousGeneration);
    } catch (error) {
      log.error('Failed to release checkout credit snapshot:', error);
    }
  }
  try {
    await withCheckoutStorageTimeout(
      persistCheckoutGeneration(next.checkoutGeneration)
    );
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
  return next;
}
