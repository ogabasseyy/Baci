import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { usePiggyvestPrimaryCapability } from '@/lib/piggyvest-primary-capability';

/**
 * Refetches the cached wallet when the server stops ruling PiggyVest out
 * for this merchant mid-session (Codex). A wallet loaded while PiggyVest
 * was off has the plain legacy shape; without a refetch, purchase screens
 * would keep treating it as legacy and offer bank transfers that may now
 * fund PiggyVest savings. The refetch also holds those transfers while
 * it runs. Merchants that stay ruled out never refetch.
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
    if (was === false && capability !== false) {
      void queryClient.invalidateQueries({
        queryKey: walletQueryKey,
        exact: true,
      });
    }
  }, [capability, queryClient]);
}
