import {
  type CartItemIdentity,
  type CartMergeResolution,
  cartLineIdentity,
} from '@baci/shared/cart';
import {
  type CartPairingLink,
  cartPairingRevision,
  clearCartPairingLink,
  peekCartPairingLink,
} from '@/lib/cart/pairing-link';
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

/** Runs one pairing choice; returns false only when the pair itself fails. */
export async function pairWithSharedCart(input: {
  ready: boolean;
  revision: number;
  pair:
    | ((
        link: CartPairingLink,
        choice: 'connect' | 'merge' | 'keep_existing',
        resolutions?: CartMergeResolution[]
      ) => Promise<void>)
    | null;
  mergeConflicts: readonly CartItemIdentity[];
  resolutions: Record<string, 'existing' | 'incoming'>;
  choice: 'connect' | 'merge' | 'keep_existing';
}): Promise<boolean> {
  const current = peekCartPairingLink();
  if (
    !current ||
    !input.ready ||
    !input.pair ||
    cartPairingRevision() !== input.revision
  )
    return true;
  markSharedCartIntent();
  try {
    await input.pair(
      current,
      input.choice,
      input.mergeConflicts.flatMap((item) => {
        const keep = input.resolutions[cartLineIdentity(item)];
        return keep ? [{ item, keep }] : [];
      })
    );
    return true;
  } catch {
    return false;
  }
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
