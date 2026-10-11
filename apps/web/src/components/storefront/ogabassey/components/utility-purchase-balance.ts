import type { Dispatch, SetStateAction } from 'react';
import type { UtilityCheckoutResult } from './utility-checkout-submit';

type WalletSuccessResult = Extract<
  UtilityCheckoutResult,
  { kind: 'wallet-success' }
>;

/**
 * Applies the wallet-balance effect of a checkout result. Extracted from
 * `use-utility-purchase` to keep that hook under the 300-line modularity
 * budget.
 *
 * A replayed reference is the same debit — only apply the balance effect
 * the first time it is seen. Buy-again purchases mint new references, so
 * genuine repeat buys still decrement. Non-terminal `processing` defers
 * the effect entirely (without recording the reference): the vend may
 * still fail and refund, and a stale-low balance would wrongly block the
 * next submit as underfunded. Ambiguous replays (a NOTED processing
 * response resolving, or a recalled key succeeding with no noted
 * reference after a lost response + reload) refresh for server truth
 * instead of decrementing a second time — the debit is already
 * reflected in the displayed balance.
 */
export function applyUtilityPurchaseBalanceEffect({
  appliedReferences,
  isAmbiguousReplay,
  refreshWallet,
  result,
  setWalletBalance,
  submitAmount,
}: {
  appliedReferences: Set<string>;
  isAmbiguousReplay: boolean;
  refreshWallet: () => void;
  result: WalletSuccessResult;
  setWalletBalance: Dispatch<SetStateAction<number>>;
  submitAmount: number;
}): void {
  if (isAmbiguousReplay) {
    appliedReferences.add(result.reference);
    refreshWallet();
    return;
  }
  if (result.processing || appliedReferences.has(result.reference)) {
    return;
  }
  appliedReferences.add(result.reference);
  // Prefer the server's post-transaction balance when cashback was
  // credited — the local decrement would otherwise display too low a
  // balance and block a valid follow-up purchase as underfunded.
  if (typeof result.cashback?.newBalance === 'number') {
    setWalletBalance(result.cashback.newBalance);
  } else {
    setWalletBalance((balance) => Math.max(balance - submitAmount, 0));
  }
}
