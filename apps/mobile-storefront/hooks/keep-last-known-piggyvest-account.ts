import type { WalletQueryData } from './wallet-query';

/**
 * A failed PiggyVest read (server unreachable) never makes a known PiggyVest
 * customer look new (walk 11): the account number from this wallet's last
 * load is kept, so the card shows the account and Add money instead of
 * "Create account number". The balance stays unknown (primary_unavailable),
 * so the card shows "—", never an old figure. Only the same query (same
 * account and store) supplies the previous load.
 */
export function keepLastKnownPiggyvestAccount(
  next: WalletQueryData,
  previous: WalletQueryData | undefined
): WalletQueryData {
  const prior = previous?.wallet.funding_account;
  if (
    next.wallet.primary_unavailable !== true ||
    next.wallet.funding_account ||
    prior?.provider !== 'piggyvest'
  )
    return next;
  return {
    ...next,
    wallet: {
      ...next.wallet,
      funding_account: prior,
      requires_funding_account_consent: false,
    },
  };
}
