import AsyncStorage from '@react-native-async-storage/async-storage';
import { CHECKOUT_IDEMPOTENCY_ITEM_SORT_V2_STORAGE_KEY } from '@/config/checkout-storage';

export async function releaseCodepointCheckoutItemSort(
  checkoutGeneration: string
): Promise<void> {
  // Lifecycle mirror of the credit snapshot: the marker is pruned once its
  // generation can no longer be replayed, so completed carts leave no
  // residue behind. Only this generation's key is removed.
  await AsyncStorage.removeItem(
    `${CHECKOUT_IDEMPOTENCY_ITEM_SORT_V2_STORAGE_KEY}:${checkoutGeneration}`
  );
}
