import { clearCartPairingLink } from '@/lib/cart/pairing-link';
import { useNativeSharedCartStore } from '@/stores/native-shared-cart-store';
import { markSharedCartIntent } from '@/stores/shared-cart-writer';

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
