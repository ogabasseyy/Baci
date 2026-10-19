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
 *
 * The local decrement is tied to the pre-submit balance generation
 * (Codex R98 P2): a wallet refresh that lands after the server debit
 * but before the vend response (e.g. from the still-mounted funding
 * panel) already puts the post-debit balance into state, and
 * decrementing again would leave an artificially low balance that
 * blocks valid follow-ups as underfunded. A moved balance refreshes
 * for server truth instead.
 */
export function applyUtilityPurchaseBalanceEffect({
  appliedReferences,
  getCurrentBalance,
  isAmbiguousReplay,
  refreshWallet,
  result,
  setWalletBalance,
  submitAmount,
  submitBalance,
}: {
  appliedReferences: Set<string>;
  getCurrentBalance: () => number;
  isAmbiguousReplay: boolean;
  refreshWallet: () => void;
  result: WalletSuccessResult;
  setWalletBalance: Dispatch<SetStateAction<number>>;
  submitAmount: number;
  submitBalance: number;
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
    // Moved-state check OUTSIDE the updater (Codex R109 P2):
    // updater functions must be pure — React may replay them
    // during StrictMode/concurrent rendering, and the old
    // refreshWallet() call inside scheduled duplicate refresh
    // generations plus nested render-phase updates (the
    // "idempotent, StrictMode-safe" claim was wrong). The live
    // reader observes the same committed state the updater would:
    // this runs at response-settle, after all updates flush.
    const currentBalance = getCurrentBalance();
    if (currentBalance !== submitBalance) {
      // State moved since submit: a refresh already applied the
      // debit (or another purchase landed) — decrementing again
      // would double-count. Refresh converges to server truth.
      refreshWallet();
    } else {
      setWalletBalance(Math.max(currentBalance - submitAmount, 0));
    }
  }
}
