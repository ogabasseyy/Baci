import { useState } from 'react';
import type { WalletData } from '@/hooks/wallet-query';
import { usePrimaryWalletCreditPoll } from './use-primary-wallet-credit-poll';
import { usePrimaryWalletUnknownRetry } from './use-primary-wallet-unknown-retry';

interface PrimaryWalletWatchInput {
  wallet: WalletData | undefined;
  /** Fund panel open: the credit poll only runs while it is. */
  showFundPanel: boolean;
  /** Account + merchant scope; a change drops the retained balance. */
  scopeKey: string;
  refetch: () => unknown;
}

/**
 * Keeps the last confirmed PiggyVest main-wallet balance across a transient
 * read failure (the wallet reports `primary_unavailable`, or has no data), so
 * the balance does not flip to the legacy figure and the credit poll keeps
 * running. Any authoritative answer (not ready, pending account, ready with
 * a balance) or a scope change replaces or clears it. Returns the wallet with
 * the retained balance applied, and runs the credit poll on it.
 */
export function usePrimaryWalletWatch({
  wallet,
  showFundPanel,
  scopeKey,
  refetch,
}: PrimaryWalletWatchInput): WalletData | undefined {
  // State, not a ref: adjusted during render behind a guard that converges
  // (React's "adjust state when props change" pattern, compiler-safe).
  const [retained, setRetained] = useState<{
    scopeKey: string;
    kobo: number | null;
  }>({ scopeKey, kobo: null });
  let kobo = retained.scopeKey === scopeKey ? retained.kobo : null;
  if (wallet) {
    if (typeof wallet.primary_balance_kobo === 'number') {
      kobo = wallet.primary_balance_kobo;
    } else if (!wallet.primary_unavailable) {
      kobo = null;
    }
  }
  if (retained.scopeKey !== scopeKey || retained.kobo !== kobo) {
    setRetained({ scopeKey, kobo });
  }
  const effective =
    wallet && kobo !== null && typeof wallet.primary_balance_kobo !== 'number'
      ? // A kept balance, not a fresh answer: marked so nothing treats it
        // as current (any money decision re-reads PiggyVest fresh).
        { ...wallet, primary_balance_kobo: kobo, primary_stale: true }
      : wallet;
  usePrimaryWalletUnknownRetry({
    // A recalled balance is shown but still re-checked until fresh.
    unknown:
      wallet?.primary_unavailable === true || wallet?.primary_stale === true,
    scopeKey,
    refetch,
  });
  usePrimaryWalletCreditPoll({
    balanceKobo: kobo,
    enabled: showFundPanel && kobo !== null,
    scopeKey,
    refetch,
  });
  return effective;
}
