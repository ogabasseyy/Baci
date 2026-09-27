import AsyncStorage from '@react-native-async-storage/async-storage';
import { CHECKOUT_IDEMPOTENCY_ITEM_SORT_V2_STORAGE_KEY } from '@/config/checkout-storage';
import { codepointSortMarkerRecords } from '@/lib/codepoint-sort-marker-records';

export async function markCodepointCheckoutItemSort(
  checkoutGeneration: string
): Promise<void> {
  // Generation-scoped marker: marking one generation is a single blind
  // write to its own key, so it can never clobber another generation's
  // marker — even when an abandoned write lands late after a queue reset
  // detached it. Same-generation marks are idempotent. The completion is
  // noted before the write so a concurrent release observes the newer
  // mark and stands down instead of deleting it after it lands.
  codepointSortMarkerRecords.noteMarked(
    checkoutGeneration,
    codepointSortMarkerRecords.nextSequence()
  );
  await AsyncStorage.setItem(
    `${CHECKOUT_IDEMPOTENCY_ITEM_SORT_V2_STORAGE_KEY}:${checkoutGeneration}`,
    '1'
  );
}
