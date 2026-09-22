import AsyncStorage from '@react-native-async-storage/async-storage';
import { assertCheckoutRecoveryValue } from '@/lib/assert-checkout-recovery-value';
import { checkoutCreditSnapshotStore } from '@/lib/checkout-credit-snapshot-store';

async function compensateLateSnapshotRemoval(
  checkoutGeneration: string,
  releaseSequence: number
): Promise<void> {
  // A removal that settles late can delete a snapshot frozen after this
  // release: the timeout wrapper returns while removeItem is still active,
  // a corrected retry freezes fresh fields, then the delayed removal
  // deletes them. If the authority record shows a newer completed choice,
  // restore it through the generation queue — re-checking authority inside
  // the queued op — so the rewrite cannot clobber an even newer apply.
  // String comparison is exact here: every stored value is produced by one
  // builder with a fixed key order, so equal choices serialize equally.
  const latest = checkoutCreditSnapshotStore.latest(checkoutGeneration);
  if (!latest || 'tombstone' in latest || latest.sequence <= releaseSequence) {
    return;
  }
  const expected = JSON.stringify(latest.snapshot);
  const stored = await AsyncStorage.getItem(
    checkoutCreditSnapshotStore.key(checkoutGeneration)
  );
  if (stored === expected) {
    return;
  }
  await checkoutCreditSnapshotStore.enqueue(checkoutGeneration, async () => {
    const current = checkoutCreditSnapshotStore.latest(checkoutGeneration);
    if (
      !current ||
      'tombstone' in current ||
      current.sequence !== latest.sequence
    ) {
      return;
    }
    const rechecked = await AsyncStorage.getItem(
      checkoutCreditSnapshotStore.key(checkoutGeneration)
    );
    if (rechecked !== expected) {
      await AsyncStorage.setItem(
        checkoutCreditSnapshotStore.key(checkoutGeneration),
        expected
      );
    }
  });
}

export async function releaseCheckoutCreditSnapshot(
  checkoutGeneration: string
): Promise<void> {
  assertCheckoutRecoveryValue(checkoutGeneration, 'generation');
  // Best-effort cleanup deletes only this generation's key: it cannot drop
  // another checkout's snapshot, and it never waits on the apply queue, so
  // a hung apply cannot wedge payment completion. The tombstone retires the
  // completed choice so a stale in-flight apply can never resurrect it and
  // the next apply freezes fresh fields. Compensation for a late removal
  // runs detached so it never delays the caller.
  const releaseSequence = checkoutCreditSnapshotStore.nextSequence();
  checkoutCreditSnapshotStore.noteTombstone(
    checkoutGeneration,
    releaseSequence
  );
  await AsyncStorage.removeItem(
    checkoutCreditSnapshotStore.key(checkoutGeneration)
  );
  void compensateLateSnapshotRemoval(checkoutGeneration, releaseSequence).catch(
    () => undefined
  );
}
