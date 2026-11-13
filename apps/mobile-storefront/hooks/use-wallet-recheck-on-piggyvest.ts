import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { isWalletPrimaryUnknown } from '@/lib/is-wallet-primary-unknown';
import { usePiggyvestPrimaryCapability } from '@/lib/piggyvest-primary-capability';
import { readObservedPiggyvestPrimaryCapability } from '@/lib/piggyvest-primary-capability-cache';
import { isWalletStoreCredit } from '@/lib/wallet-store-credit';
import { usePiggyvestCapabilityNow } from './use-piggyvest-capability-now';
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
  walletQueryKey: QueryKey,
  /** The query's wallet: reactive, so a restore after the verdict re-runs. */
  cached: WalletQueryData['wallet'] | undefined
): void {
  const capability = usePiggyvestPrimaryCapability(merchantId);
  // The live verdict also sees a rollback written by a mounted flow.
  const verdictNow = usePiggyvestCapabilityNow(merchantId);
  // The wallet's scope (user, owner, merchant): a new account can restore
  // its own legacy wallet cached before PiggyVest was enabled (Codex).
  const scope = JSON.stringify(walletQueryKey);
  const cachedLegacy =
    cached !== undefined &&
    cached.owner_unresolved !== true &&
    !isWalletStoreCredit(cached) &&
    !isWalletPrimaryUnknown(cached);
  // PiggyVest-shaped: a PiggyVest balance, a pending PiggyVest account, or
  // an unavailable read (no funding account cached) once the server has
  // actually ruled PiggyVest out (Codex); a default false never reloads it.
  const cachedPrimary =
    cached !== undefined &&
    (isWalletStoreCredit(cached) ||
      cached.primary_pending === true ||
      (!!merchantId &&
        isWalletPrimaryUnknown(cached) &&
        readObservedPiggyvestPrimaryCapability(merchantId) === false));
  // The live verdict (it follows rollbacks), else the hook's own answer.
  const verdict = verdictNow ?? capability;
  // State, not transitions (Codex): whenever the current verdict and the
  // cached wallet's shape disagree, reload once for that combination. This
  // covers rollbacks before mount, restores after a verdict, account
  // switches and a re-probe that turns positive again.
  const mismatch =
    (verdict === true && cachedLegacy) || (verdict === false && cachedPrimary);
  const mismatchKey = mismatch
    ? `${scope}|${String(verdict)}|${cachedLegacy ? 'legacy' : 'primary'}`
    : null;
  // Only a mismatch reloads (Codex): a ruled-out merchant's negative-cache
  // expiry alone never does, since the live verdict stays false for it.
  const previous = useRef<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies(walletQueryKey): `scope` (inside mismatchKey) is its serialised form; the key is read at that moment.
  useEffect(() => {
    const was = previous.current;
    previous.current = mismatchKey;
    if (mismatchKey !== null && mismatchKey !== was) {
      void queryClient.invalidateQueries({
        queryKey: walletQueryKey,
        exact: true,
      });
    }
  }, [mismatchKey, queryClient]);
}
