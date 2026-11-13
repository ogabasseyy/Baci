import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { isWalletPrimaryUnknown } from '@/lib/is-wallet-primary-unknown';
import { usePiggyvestPrimaryCapability } from '@/lib/piggyvest-primary-capability';
import { isWalletStoreCredit } from '@/lib/wallet-store-credit';
import type { WalletQueryData } from './wallet-query';

/**
 * Refetches the cached wallet when the server stops ruling PiggyVest out
 * for this merchant mid-session (Codex). A wallet loaded while PiggyVest
 * was off has the plain legacy shape; without a refetch, purchase screens
 * would keep treating it as legacy and offer bank transfers that may now
 * fund PiggyVest savings. The refetch also holds those transfers while
 * it runs. Merchants that stay ruled out never refetch.
 *
 * The first positive verdict (unknown → true) also refetches when the
 * cached wallet has the plain legacy shape: after a cold restart the query
 * cache can restore a wallet saved while PiggyVest was ruled out (Codex).
 */
export function useWalletRecheckOnPiggyvest(
  queryClient: QueryClient,
  merchantId: string | null | undefined,
  walletQueryKey: QueryKey
): void {
  const capability = usePiggyvestPrimaryCapability(merchantId);
  const previous = useRef(capability);
  // biome-ignore lint/correctness/useExhaustiveDependencies(walletQueryKey): only a capability change retriggers; the key is read at that moment.
  useEffect(() => {
    const was = previous.current;
    previous.current = capability;
    const turnedOn = was === false && capability !== false;
    const cached =
      queryClient.getQueryData<WalletQueryData>(walletQueryKey)?.wallet;
    const firstVerdictOnLegacyCache =
      was === null &&
      capability === true &&
      cached !== undefined &&
      !isWalletStoreCredit(cached) &&
      !isWalletPrimaryUnknown(cached);
    if (turnedOn || firstVerdictOnLegacyCache) {
      void queryClient.invalidateQueries({
        queryKey: walletQueryKey,
        exact: true,
      });
    }
  }, [capability, queryClient]);
}
