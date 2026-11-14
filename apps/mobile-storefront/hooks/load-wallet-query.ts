import { keepLastKnownPiggyvestAccount } from './keep-last-known-piggyvest-account';
import { fetchWalletDataUnbounded } from './wallet-data';
import { runWithWalletLoadDeadline } from './wallet-load-deadline';
import type { WalletQueryData } from './wallet-query';

/**
 * The wallet query's load: the bounded wallet read, then the last-known
 * PiggyVest account kept through a failed PiggyVest read (walk 11).
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
  return keepLastKnownPiggyvestAccount(next, previous());
}
