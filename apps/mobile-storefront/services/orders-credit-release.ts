import { releaseCheckoutCreditSnapshot } from '@/lib/checkout-attempt-credit-snapshot';
import { createLogger } from '@/lib/logger';
import { withCheckoutStorageTimeout } from '@/lib/with-checkout-storage-timeout';

const log = createLogger('Order');

const DEFINITIVE_REJECTION_CODES = new Set([
  'VALIDATION_ERROR',
  'AUTH_ERROR',
  'NOT_FOUND',
]);

export async function releaseCreditAfterDefinitiveRejection(
  code: string,
  checkoutGeneration: string
): Promise<void> {
  // Definitive rejections create no order, so drop the frozen credit choice
  // and let the shopper's corrected retry snapshot fresh fields. Ambiguous
  // outcomes (conflicts, timeouts, network and server errors) retain the
  // snapshot so a lost-response retry reuses the same idempotency key.
  if (!DEFINITIVE_REJECTION_CODES.has(code)) {
    return;
  }
  try {
    await withCheckoutStorageTimeout(
      releaseCheckoutCreditSnapshot(checkoutGeneration)
    );
  } catch (error) {
    log.warn('Failed to release credit snapshot after order rejection:', error);
  }
}
