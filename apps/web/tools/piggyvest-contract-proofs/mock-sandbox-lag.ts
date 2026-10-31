import type { Txn, Wallet } from './mock-sandbox-types';

/**
 * Read-after-write lag for the mock: a settled change that later reads do not
 * show yet. Each helper is a no-op when the matching lag option is 0.
 */

/** Call BEFORE changing the balance: reads keep showing the old value for `lagReads` reads. */
export function markStaleBalance(wallet: Wallet, lagReads: number): void {
  if (lagReads <= 0) return;
  wallet.staleBalance = {
    value: wallet.staleBalance?.value ?? wallet.balance,
    readsLeft: lagReads,
  };
}

/** The balance one read would show; consumes one stale read. */
export function visibleBalance(wallet: Wallet): number {
  const stale = wallet.staleBalance;
  if (!stale) return wallet.balance;
  if (stale.readsLeft > 0) {
    stale.readsLeft -= 1;
    return stale.value;
  }
  wallet.staleBalance = null;
  return wallet.balance;
}

/** Transactions one list read would show; consumes one hidden read per hidden row. */
export function listedTransactions(txns: readonly Txn[]): Txn[] {
  const visible = txns.filter((txn) => txn.hiddenReads <= 0);
  for (const txn of txns) {
    if (txn.hiddenReads > 0) txn.hiddenReads -= 1;
  }
  return visible;
}

/** Whether a wallet readback shows interest settings yet; consumes one hidden read. */
export function settingsVisible(wallet: Wallet): boolean {
  if (wallet.settingsHiddenReads <= 0) return true;
  wallet.settingsHiddenReads -= 1;
  return false;
}

/** Whether a wallet readback shows its payout destination yet; consumes one hidden read. */
export function payoutVisible(wallet: Wallet): boolean {
  if (wallet.payoutHiddenReads <= 0) return true;
  wallet.payoutHiddenReads -= 1;
  return false;
}
