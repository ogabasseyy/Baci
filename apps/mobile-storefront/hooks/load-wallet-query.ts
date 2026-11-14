import { keepLastKnownPiggyvestAccount } from './keep-last-known-piggyvest-account';
import {
  readLastKnownPiggyvestAccount,
  syncLastKnownPiggyvestAccount,
} from './last-known-piggyvest-account-storage';
import { fetchWalletDataUnbounded } from './wallet-data';
import { runWithWalletLoadDeadline } from './wallet-load-deadline';
import type { WalletQueryData } from './wallet-query';

/**
 * The previous load to keep a PiggyVest account from: this query's cached
 * data, or, when that has none (cold launch after the cache was dropped,
 * walk 14), the account saved on the device for this store and user.
 */
async function previousWithSavedAccount(
  next: WalletQueryData,
  cached: WalletQueryData | undefined,
  merchantId: string,
  userId: string | null
): Promise<WalletQueryData | undefined> {
  if (
    !userId ||
    next.wallet.primary_unavailable !== true ||
    next.wallet.funding_account ||
    cached?.wallet.funding_account?.provider === 'piggyvest'
  )
    return cached;
  const saved = await readLastKnownPiggyvestAccount(merchantId, userId);
  return saved
    ? { transactions: [], wallet: { ...next.wallet, funding_account: saved } }
    : cached;
}

/**
 * The wallet query's load: the bounded wallet read, then the last-known
 * PiggyVest account kept through a failed PiggyVest read (walks 11 and 14).
 * `previous` reads this same query's cached data when the load settles.
 */
export async function loadWalletQuery({
  customerId,
  merchantId,
  previous,
  signal,
  userId,
}: {
  customerId: string | null;
  merchantId: string;
  previous: () => WalletQueryData | undefined;
  signal?: AbortSignal;
  userId: string | null;
}): Promise<WalletQueryData> {
  const next = await runWithWalletLoadDeadline(
    () => fetchWalletDataUnbounded(customerId, merchantId, userId),
    signal
  );
  if (userId) await syncLastKnownPiggyvestAccount(merchantId, userId, next);
  const prior = await previousWithSavedAccount(
    next,
    previous(),
    merchantId,
    userId
  );
  return keepLastKnownPiggyvestAccount(next, prior);
}
