import { QueryClientContext } from '@tanstack/react-query';
import { useContext } from 'react';

/** The query key every PiggyVest wallet activity list is stored under. */
export const WALLET_ACTIVITY_QUERY_KEY = ['piggyvest-wallet-activity'] as const;

/**
 * Marks the wallet activity lists stale so the next time the wallet opens it
 * reads the server again, instead of showing its 5-minute cache without the
 * payment just made (Fable walk 17). Called when a wallet-pay settles, next
 * to the wallet refetch. A screen with no query provider has no list to
 * refresh, so it does nothing there.
 */
export function useRefreshWalletActivity() {
  // The context directly: unlike useQueryClient it does not throw when a
  // screen has no provider.
  const client = useContext(QueryClientContext);
  return () => {
    void client?.invalidateQueries({ queryKey: WALLET_ACTIVITY_QUERY_KEY });
  };
}
