import { clearCartPairingLink } from '@/lib/cart/pairing-link';
import { useNativeSharedCartStore } from '@/stores/native-shared-cart-store';
import { markSharedCartIntent } from '@/stores/shared-cart-writer';

interface PairingSyncOperations {
  snapshot: unknown;
  prepare: (() => Promise<void>) | null;
  refresh: (() => Promise<void>) | null;
}

/** A read-only refresh cannot create a missing canonical cart. */
export function pairingRetryOperation(
  shared: PairingSyncOperations,
  itemCount: number
): (() => Promise<void>) | null {
  const preferred =
    shared.snapshot || itemCount === 0 ? shared.refresh : shared.prepare;
  return preferred ?? shared.prepare ?? shared.refresh;
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
