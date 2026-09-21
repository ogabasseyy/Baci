import AsyncStorage from '@react-native-async-storage/async-storage';
import { CHECKOUT_GENERATION_STORAGE_KEY } from '@/config/checkout-storage';
import { assertCheckoutRecoveryValue } from '@/lib/assert-checkout-recovery-value';
import { enqueueCheckoutGenerationStorage } from '@/lib/checkout-generation-storage-queue';
import { markCodepointCheckoutItemSort } from '@/lib/checkout-idempotency-item-sort';
import { createLogger } from '@/lib/logger';
import { isMintedCheckoutGeneration } from '@/lib/minted-checkout-generations';

const log = createLogger('CartStore');

export async function persistCheckoutGeneration(
  checkoutGeneration: string
): Promise<void> {
  assertCheckoutRecoveryValue(checkoutGeneration, 'generation');
  await enqueueCheckoutGenerationStorage(async () => {
    await AsyncStorage.setItem(
      CHECKOUT_GENERATION_STORAGE_KEY,
      checkoutGeneration
    );
    // Only generations minted by this build are code-point sorted. Restored
    // legacy IDs keep locale ordering even when persisted over a newer value.
    if (isMintedCheckoutGeneration(checkoutGeneration)) {
      await markCodepointCheckoutItemSort(checkoutGeneration);
    }
  });
}

export function persistCheckoutGenerationDetached(
  checkoutGeneration: string
): void {
  void persistCheckoutGeneration(checkoutGeneration).catch((error) => {
    log.error('Failed to persist checkout generation:', error);
  });
}
