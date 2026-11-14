import { useState } from 'react';
import { usePiggyvestCapabilityNow } from '@/hooks/use-piggyvest-capability-now';
import type { WalletData } from '@/hooks/wallet-query';
import { CONFIG } from '@/lib/config';
import { pickMerchantId } from '@/lib/pick-merchant-id';
import { useAuthStore } from '@/stores/auth-store';
import { usePrimaryWalletCreditPoll } from './use-primary-wallet-credit-poll';
import { usePrimaryWalletUnknownRetry } from './use-primary-wallet-unknown-retry';
import { withoutRuledOutPrimary } from './without-ruled-out-primary';

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
  // Also poll a PiggyVest account whose balance is still pending (Codex):
  // its Add money sheet shows the account but has no other credit check,
  // so a transfer that makes the balance available must refetch.
  const pendingAccount =
    wallet?.primary_pending === true &&
    wallet.funding_account?.provider === 'piggyvest';
  usePrimaryWalletCreditPoll({
    balanceKobo: kobo,
    enabled: showFundPanel && (kobo !== null || pendingAccount),
    scopeKey,
    refetch,
  });
  // Same merchant resolution as the wallet reads.
  const verdict = usePiggyvestCapabilityNow(
    pickMerchantId(
      useAuthStore((state) => state.merchantId),
      CONFIG.MERCHANT_ID
    )
  );
  // Once ruled out, PiggyVest stays suppressed until a positive verdict
  // re-confirms it (Codex): the ruling-out expiring to "unknown", or a
  // failed re-probe, must not bring a stale savings balance back.
  // Scoped to the account + merchant (Codex): merchant A's ruling-out never
  // strips merchant B's cached savings balance.
  const [latch, setLatch] = useState<{
    scopeKey: string;
    suppressed: boolean;
  }>({ scopeKey, suppressed: false });
  const suppressed = latch.scopeKey === scopeKey && latch.suppressed;
  const nextSuppressed =
    verdict === false ? true : verdict === true ? false : suppressed;
  if (latch.scopeKey !== scopeKey || nextSuppressed !== latch.suppressed) {
    setLatch({ scopeKey, suppressed: nextSuppressed });
  }
  return withoutRuledOutPrimary(effective, nextSuppressed ? false : verdict);
}
