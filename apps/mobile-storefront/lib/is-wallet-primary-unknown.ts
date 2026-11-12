import {
  isWalletStoreCredit,
  type WalletPrimaryLike,
} from './wallet-store-credit';

/**
 * True while the PiggyVest check failed or timed out, so nobody knows yet
 * whether this customer's wallet is PiggyVest. Wording stays as today, but
 * screens hold back bank-transfer top-ups until the check is retried: a
 * PiggyVest customer's transfer would land in savings, not store credit.
 */
export function isWalletPrimaryUnknown(
  wallet: WalletPrimaryLike | null | undefined
): boolean {
  return wallet?.primary_unavailable === true && !isWalletStoreCredit(wallet);
}
