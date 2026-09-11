import { clearPersistedCheckoutGeneration } from '@/lib/clear-persisted-checkout-generation';
import { createLogger } from '@/lib/logger';
import { persistCheckoutGeneration } from '@/lib/persist-checkout-generation';
import { emptyCheckoutCart } from './empty-checkout-cart';

const log = createLogger('CartStore');

export async function rotateEmptyCheckoutCart(
  apply: (next: ReturnType<typeof emptyCheckoutCart>) => void
) {
  const next = emptyCheckoutCart();
  apply(next);
  try {
    await persistCheckoutGeneration(next.checkoutGeneration);
  } catch (error) {
    log.error('Failed to persist empty-cart checkout generation:', error);
    try {
      await clearPersistedCheckoutGeneration();
    } catch (clearError) {
      log.error(
        'Failed to clear stale checkout generation after persist rejection:',
        clearError
      );
    }
  }
  return next;
}
