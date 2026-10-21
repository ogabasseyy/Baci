import { clearCartPairingLink } from '@/lib/cart/pairing-link';
import { useNativeSharedCartStore } from '@/stores/native-shared-cart-store';
import { markSharedCartIntent } from '@/stores/shared-cart-writer';

interface PairingSyncOperations {
  snapshot: unknown;
  prepare: (() => Promise<void>) | null;
  refresh: (() => Promise<void>) | null;
}

/**
 * A read-only refresh cannot create a missing canonical cart, and prepare
 * is a no-op once a snapshot exists, so each state has exactly one useful
 * retry operation (or none, when that operation is unbound).
 */
export function pairingRetryOperation(
  shared: PairingSyncOperations,
  itemCount: number
): (() => Promise<void>) | null {
  if (shared.snapshot) return shared.refresh;
  if (itemCount === 0) return shared.refresh;
  return shared.prepare ?? shared.refresh;
}

/** Pairing-published conflicts have no resolution path once dismissed. */
export function dismissPairingLink(): void {
  clearCartPairingLink();
  const state = useNativeSharedCartStore.getState();
  if (state.status !== 'choice_required' && state.mergeConflicts.length) {
    markSharedCartIntent();
    useNativeSharedCartStore.setState({
      mergeConflicts: [],
      mergeConflictReason: undefined,
    });
  }
}
