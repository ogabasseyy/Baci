import AsyncStorage from '@react-native-async-storage/async-storage';
import { assertCheckoutRecoveryValue } from '@/lib/assert-checkout-recovery-value';
import { checkoutCreditSnapshotStore } from '@/lib/checkout-credit-snapshot-store';

export async function releaseCheckoutCreditSnapshot(
  checkoutGeneration: string
): Promise<void> {
  assertCheckoutRecoveryValue(checkoutGeneration, 'generation');
  // Best-effort cleanup deletes only this generation's key: it cannot drop
  // another checkout's snapshot, and it never waits on the apply queue, so
  // a hung apply cannot wedge payment completion. The tombstone retires the
  // completed choice so a stale in-flight apply can never resurrect it and
  // the next apply freezes fresh fields.
  checkoutCreditSnapshotStore.noteTombstone(
    checkoutGeneration,
    checkoutCreditSnapshotStore.nextSequence()
  );
  await AsyncStorage.removeItem(
    checkoutCreditSnapshotStore.key(checkoutGeneration)
  );
}
