import type { WalletQueryData } from './wallet-query';

/**
 * Marks a shown PiggyVest balance as last known once a wallet re-read has
 * failed (walk 15): a failed pull-to-refresh or background read leaves the
 * cached wallet on screen, which must say it may be out of date. `failed`
 * is any failed attempt of the current read, or a final error newer than
 * the data. The same object comes back when nothing changes.
 */
export function markWalletReadFailed(
  data: WalletQueryData | undefined,
  read: { dataUpdatedAt: number; errorUpdatedAt: number; failureCount: number }
): WalletQueryData | undefined {
  const failed =
    read.failureCount > 0 || read.errorUpdatedAt > read.dataUpdatedAt;
  if (
    !failed ||
    !data ||
    typeof data.wallet.primary_balance_kobo !== 'number' ||
    data.wallet.primary_stale === true
  )
    return data;
  return { ...data, wallet: { ...data.wallet, primary_stale: true } };
}
