import AsyncStorage from '@react-native-async-storage/async-storage';
import { checkoutGenerationStorageQueue } from '@/lib/checkout-generation-storage-queue';
import { codepointSortMarkerRecords } from '@/lib/codepoint-sort-marker-records';

export function releaseCodepointCheckoutItemSort(
  checkoutGeneration: string
): Promise<void> {
  // Lifecycle mirror of the credit snapshot: the marker is pruned once its
  // generation can no longer be replayed, so completed carts leave no
  // residue behind. Only this generation's key is removed.
  //
  // The physical removal runs detached through the generation queue and
  // rechecks authority immediately before deleting, with no await between
  // the check and the removal call: a marker restored after this release
  // (for example by a cart rollback) is never deleted. When the removal
  // was already in flight while the restoration landed, the
  // post-settlement verification rewrites the idempotent marker.
  const releaseSequence = codepointSortMarkerRecords.nextSequence();
  codepointSortMarkerRecords.noteTombstone(checkoutGeneration, releaseSequence);
  void checkoutGenerationStorageQueue
    .enqueue(async () => {
      const current = codepointSortMarkerRecords.latest(checkoutGeneration);
      if (
        current &&
        'marked' in current &&
        current.sequence > releaseSequence
      ) {
        return;
      }
      await AsyncStorage.removeItem(
        codepointSortMarkerRecords.key(checkoutGeneration)
      );
      const after = codepointSortMarkerRecords.latest(checkoutGeneration);
      if (after && 'marked' in after && after.sequence > releaseSequence) {
        await AsyncStorage.setItem(
          codepointSortMarkerRecords.key(checkoutGeneration),
          '1'
        );
      }
    })
    .catch(() => undefined);
  return Promise.resolve();
}
