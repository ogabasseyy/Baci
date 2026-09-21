import AsyncStorage from '@react-native-async-storage/async-storage';
import { CHECKOUT_IDEMPOTENCY_ITEM_SORT_V2_STORAGE_KEY } from '@/config/checkout-storage';
import { enqueueCheckoutGenerationStorage } from '@/lib/checkout-generation-storage-queue';
import { isMintedCheckoutGeneration } from '@/lib/minted-checkout-generations';

function parseGenerationSet(existing: string | null): string[] {
  if (existing === null) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(existing);
  } catch {
    throw new Error(
      'Checkout recovery data is invalid. Please contact support.'
    );
  }
  if (
    !Array.isArray(parsed) ||
    parsed.some((entry) => typeof entry !== 'string')
  ) {
    throw new Error(
      'Checkout recovery data is invalid. Please contact support.'
    );
  }
  return parsed;
}

export async function markCodepointCheckoutItemSort(
  checkoutGeneration: string
): Promise<void> {
  const generations = parseGenerationSet(
    await AsyncStorage.getItem(CHECKOUT_IDEMPOTENCY_ITEM_SORT_V2_STORAGE_KEY)
  );
  if (generations.includes(checkoutGeneration)) {
    return;
  }
  generations.push(checkoutGeneration);
  await AsyncStorage.setItem(
    CHECKOUT_IDEMPOTENCY_ITEM_SORT_V2_STORAGE_KEY,
    JSON.stringify(generations)
  );
}

export function usesCodepointCheckoutItemSort(
  checkoutGeneration: string
): Promise<boolean> {
  if (isMintedCheckoutGeneration(checkoutGeneration)) {
    return Promise.resolve(true);
  }
  return enqueueCheckoutGenerationStorage(async () => {
    const generations = parseGenerationSet(
      await AsyncStorage.getItem(CHECKOUT_IDEMPOTENCY_ITEM_SORT_V2_STORAGE_KEY)
    );
    return generations.includes(checkoutGeneration);
  });
}
