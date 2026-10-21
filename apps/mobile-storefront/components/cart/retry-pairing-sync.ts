import { useNativeSharedCartStore } from '@/stores/native-shared-cart-store';
import { markSharedCartIntent } from '@/stores/shared-cart-writer';
import { pairingRetryOperation } from './pairing-retry-operation';
import type { PairingSyncOperations } from './pairing-sync-operations';

/** Preserve the failed handoff until retry commits a changed canonical cart. */
export async function retryPairingSync(
  shared: PairingSyncOperations & {
    snapshot: { cartId: string; version: number } | null;
  },
  itemCount: number
): Promise<boolean> {
  markSharedCartIntent();
  const before = shared.snapshot;
  try {
    await pairingRetryOperation(shared, itemCount)?.();
    const after = useNativeSharedCartStore.getState().snapshot;
    // Creating a local cart alone does not redeem the incoming handoff.
    return Boolean(
      before &&
        after &&
        (after.cartId !== before.cartId || after.version !== before.version)
    );
  } catch {
    return false;
  }
}
