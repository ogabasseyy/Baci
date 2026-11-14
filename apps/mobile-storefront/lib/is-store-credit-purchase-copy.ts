import {
  isWalletStoreCredit,
  type WalletPrimaryLike,
} from '@/lib/wallet-store-credit';

/**
 * Purchase screens call the spendable balance "Store credit" once the
 * PiggyVest wallet is ready, and also while a confirmed PiggyVest account's
 * balance is still pending (Codex): any purchase top-up adds store credit.
 * Copy only; the readiness predicate (isWalletStoreCredit) is unchanged so
 * the pending state still holds bank-transfer funding as unknown.
 */
export function isStoreCreditPurchaseCopy(
  wallet: WalletPrimaryLike | null | undefined
): boolean {
  return isWalletStoreCredit(wallet) || wallet?.primary_pending === true;
}
