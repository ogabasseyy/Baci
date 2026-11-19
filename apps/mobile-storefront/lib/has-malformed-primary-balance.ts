import {
  isWalletStoreCredit,
  type WalletPrimaryLike,
} from './wallet-store-credit';

/**
 * True when the server sent a PiggyVest balance we can't trust (negative or
 * non-finite). That is neither a PiggyVest answer nor a ruling-out, so
 * purchase top-ups treat the wallet as unsettled (card-only store credit).
 */
export function hasMalformedPrimaryBalance(
  wallet: WalletPrimaryLike | null | undefined
): boolean {
  return (
    typeof wallet?.primary_balance_kobo === 'number' &&
    !isWalletStoreCredit(wallet)
  );
}
