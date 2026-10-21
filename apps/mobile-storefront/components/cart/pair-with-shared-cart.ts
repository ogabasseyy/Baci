import {
  type CartItemIdentity,
  type CartMergeResolution,
  cartLineIdentity,
} from '@baci/shared/cart';
import {
  type CartPairingLink,
  cartPairingRevision,
  peekCartPairingLink,
} from '@/lib/cart/pairing-link';
import { markSharedCartIntent } from '@/stores/shared-cart-writer';

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
