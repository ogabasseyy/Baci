import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { isWalletPrimaryUnknown } from '@/lib/is-wallet-primary-unknown';
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
const RECHECK_RETRY_MS = 5_000;
const RECHECK_MAX_RETRIES = 5;

export function useWalletRecheckOnPiggyvest(
  queryClient: QueryClient,
  merchantId: string | null | undefined,
  walletQueryKey: QueryKey,
  /** The query's wallet: reactive, so a restore after the verdict re-runs. */
  cached: WalletQueryData['wallet'] | undefined
): void {
  // The live verdict alone (Codex): it follows rollbacks, and an unknown one
  // stays unknown during the re-probe. Every positive probe is recorded in
  // the cache, so the capability hook adds nothing but a stale true.
  const verdict = usePiggyvestCapabilityNow(merchantId);
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
  // State, not transitions (Codex): whenever the current verdict and the
  // cached wallet's shape disagree, reload once for that combination. This
  // covers rollbacks before mount, restores after a verdict, account
  // switches and a re-probe that turns positive again.
  // A timed-out PiggyVest read cached no account: a positive verdict that
  // lands later reloads it, or checkout stays held (Codex).
  const cachedUnavailable = cached?.primary_unavailable === true;
  const mismatch =
    (verdict === true && (cachedLegacy || cachedUnavailable)) ||
    (verdict === false && cachedPrimary);
  const shape = cachedLegacy
    ? 'legacy'
    : cachedUnavailable
      ? 'unavailable'
      : 'primary';
  const mismatchKey = mismatch ? `${scope}|${String(verdict)}|${shape}` : null;
  // Only a mismatch reloads (Codex): a ruled-out merchant's negative-cache
  // expiry alone never does, since the live verdict stays false for it.
  const previous = useRef<string | null>(null);
  // A failed reload re-arms the same mismatch (Codex): checkout and
  // utilities have no other retry, so a transient failure must not leave
  // the wallet unclassified until a remount. Bounded per mismatch.
  const [retryNonce, setRetryNonce] = useState(0);
  const failures = useRef({ key: null as string | null, count: 0 });
  // biome-ignore lint/correctness/useExhaustiveDependencies(walletQueryKey): `scope` (inside mismatchKey) is its serialised form; the key is read at that moment.
  // biome-ignore lint/correctness/useExhaustiveDependencies(retryNonce): a bump re-runs the reload for the same mismatch.
  useEffect(() => {
    const was = previous.current;
    previous.current = mismatchKey;
    if (failures.current.key !== mismatchKey)
      failures.current = { key: mismatchKey, count: 0 };
    if (mismatchKey === null || mismatchKey === was) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let active = true;
    void queryClient
      .invalidateQueries({ queryKey: walletQueryKey, exact: true })
      .then(() => {
        const failed =
          queryClient.getQueryState?.(walletQueryKey)?.status === 'error';
        if (!active || !failed || failures.current.count >= RECHECK_MAX_RETRIES)
          return;
        failures.current.count += 1;
        timer = setTimeout(() => {
          previous.current = null;
          setRetryNonce((n) => n + 1);
        }, RECHECK_RETRY_MS);
      });
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [mismatchKey, queryClient, retryNonce]);
}
