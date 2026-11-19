import type { WalletData } from '@/hooks/wallet-query';

/**
 * Drops PiggyVest presentation from a cached wallet while the server's
 * current verdict rules PiggyVest out (Codex): after a rollback whose
 * reload failed, the hero must not keep a stale savings balance. The
 * legacy balance then shows as today; the PiggyVest account stays hidden
 * by useLegacyFundingUnconfirmed.
 */
export function withoutRuledOutPrimary(
  wallet: WalletData | undefined,
  verdict: boolean | null
): WalletData | undefined {
  if (!wallet || verdict !== false) return wallet;
  const piggyvestAccount = wallet.funding_account?.provider === 'piggyvest';
  if (
    typeof wallet.primary_balance_kobo !== 'number' &&
    wallet.primary_pending !== true &&
    !piggyvestAccount
  ) {
    return wallet;
  }
  const {
    primary_balance_kobo: _kobo,
    primary_pending: _pending,
    primary_stale: _stale,
    ...legacy
  } = wallet;
  // The PiggyVest account too (Codex): its provider alone would put the
  // wallet back into the savings presentation.
  return piggyvestAccount ? { ...legacy, funding_account: null } : legacy;
}
