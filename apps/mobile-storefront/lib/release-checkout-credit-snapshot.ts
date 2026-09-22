import AsyncStorage from '@react-native-async-storage/async-storage';
import { assertCheckoutRecoveryValue } from '@/lib/assert-checkout-recovery-value';
import { checkoutCreditSnapshotStore } from '@/lib/checkout-credit-snapshot-store';

export function releaseCheckoutCreditSnapshot(
  checkoutGeneration: string
): Promise<void> {
  assertCheckoutRecoveryValue(checkoutGeneration, 'generation');
  // Best-effort cleanup deletes only this generation's key: it cannot drop
  // another checkout's snapshot, and it never waits on the apply queue, so
  // a hung apply cannot wedge payment completion. The tombstone retires the
  // completed choice so a stale in-flight apply can never resurrect it and
  // the next apply freezes fresh fields.
  //
  // The physical removal runs detached through the generation queue and
  // rechecks authority immediately before deleting, with no await between
  // the check and the removal call: a retry that froze a newer choice
  // after this release keeps its snapshot even if the removal settles
  // late, and there is no delete-before-repair crash window because the
  // deletion itself is conditional — a newer choice is never deleted.
  const releaseSequence = checkoutCreditSnapshotStore.nextSequence();
  checkoutCreditSnapshotStore.noteTombstone(
    checkoutGeneration,
    releaseSequence
  );
  void checkoutCreditSnapshotStore
    .enqueue(checkoutGeneration, async () => {
      const current = checkoutCreditSnapshotStore.latest(checkoutGeneration);
      if (
        current &&
        !('tombstone' in current) &&
        current.sequence > releaseSequence
      ) {
        return;
      }
      await AsyncStorage.removeItem(
        checkoutCreditSnapshotStore.key(checkoutGeneration)
      );
    })
    .catch(() => undefined);
  return Promise.resolve();
}
