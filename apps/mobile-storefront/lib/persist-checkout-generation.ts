import AsyncStorage from '@react-native-async-storage/async-storage';
import { CHECKOUT_GENERATION_STORAGE_KEY } from '@/config/checkout-storage';
import { assertCheckoutRecoveryValue } from '@/lib/assert-checkout-recovery-value';
import { enqueueCheckoutGenerationStorage } from '@/lib/checkout-generation-storage-queue';
import { markCodepointCheckoutItemSort } from '@/lib/checkout-idempotency-item-sort';
import { createLogger } from '@/lib/logger';

const log = createLogger('CartStore');

export async function persistCheckoutGeneration(
  checkoutGeneration: string
): Promise<void> {
  assertCheckoutRecoveryValue(checkoutGeneration, 'generation');
  await enqueueCheckoutGenerationStorage(async () => {
    const previous = await AsyncStorage.getItem(
      CHECKOUT_GENERATION_STORAGE_KEY
    );
    await AsyncStorage.setItem(
      CHECKOUT_GENERATION_STORAGE_KEY,
      checkoutGeneration
    );
    if (previous !== checkoutGeneration) {
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
