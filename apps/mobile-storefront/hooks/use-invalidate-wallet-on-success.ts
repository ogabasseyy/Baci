import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { walletKeys } from '@/hooks/use-wallet';

// Module scope (no useCallback — the React Compiler owns memoization).
// Deliberately omits userId: explicit exact:false prefix matching, so
// this {merchantId, ownerId} prefix clears stored keys both with and
// without the optional userId segment (sessions with a customer row but
// no auth user store the shorter key). Passing userId here would miss
// those sessions and leave stale balances cached. The wallet root goes
// along (Codex R77 6sNGPB): the read owner is customer-first, so a
// customer row arriving between submit (cached under the auth-user
// owner) and success would otherwise leave the user-owner query
// serving the pre-debit balance as fresh. Same-tick invalidations
// dedupe to one refetch for active observers.
export function invalidateWalletBalanceQueries({
  merchantId,
  ownerId,
  queryClient,
}: {
  merchantId: string;
  ownerId: string | null;
  queryClient: QueryClient;
}): void {
  if (!ownerId) {
    return;
  }
  void queryClient.invalidateQueries({
    queryKey: walletKeys.data({ merchantId, ownerId }),
    exact: false,
  });
  void queryClient.invalidateQueries({
    queryKey: walletKeys.all,
    exact: false,
  });
}

/**
 * Refresh the cached wallet balance after a utility success lands.
 *
 * Extracted from app/utilities/[type].tsx per the 300-line Boy Scout
 * Rule (Codex R60 6rs7PZ); behavior unchanged.
 */
export function useInvalidateWalletOnSuccess({
  activeMerchantId,
  currentType,
  successReference,
  walletOwnerId,
}: {
  activeMerchantId: string;
  currentType: string | null;
  successReference: string | null | undefined;
  walletOwnerId: string | null;
}): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    // Invalidate on the resolved (session OR param) reference: every
    // wallet purchase debits, so a cached pre-debit balance would let
    // the next submit go stale. Params included on purpose — post-kill
    // restores render from params against a persisted cache; a foreign
    // shared URL costs one harmless refetch.
    if (!currentType || !successReference) {
      return;
    }
    invalidateWalletBalanceQueries({
      merchantId: activeMerchantId,
      ownerId: walletOwnerId,
      queryClient,
    });
  }, [
    activeMerchantId,
    currentType,
    queryClient,
    successReference,
    walletOwnerId,
  ]);
}
