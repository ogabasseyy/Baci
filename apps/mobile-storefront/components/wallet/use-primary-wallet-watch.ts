import { useRef } from 'react';
import type { WalletData } from '@/hooks/wallet-query';
import { usePrimaryWalletCreditPoll } from './use-primary-wallet-credit-poll';

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
  const retained = useRef<{ scopeKey: string; kobo: number | null }>({
    scopeKey,
    kobo: null,
  });
  if (retained.current.scopeKey !== scopeKey) {
    retained.current = { scopeKey, kobo: null };
  }
  if (wallet) {
    if (typeof wallet.primary_balance_kobo === 'number') {
      retained.current.kobo = wallet.primary_balance_kobo;
    } else if (!wallet.primary_unavailable) {
      retained.current.kobo = null;
    }
  }
  const kobo = retained.current.kobo;
  const effective =
    wallet && kobo !== null && typeof wallet.primary_balance_kobo !== 'number'
      ? { ...wallet, primary_balance_kobo: kobo }
      : wallet;
  usePrimaryWalletCreditPoll({
    balanceKobo: kobo,
    enabled: showFundPanel && kobo !== null,
    scopeKey,
    refetch,
  });
  return effective;
}
