import {
  isWalletStoreCredit,
  type WalletPrimaryLike,
} from '@/lib/wallet-store-credit';

export type PayingWallet = WalletPrimaryLike & {
  balance?: number;
  /** A remembered PiggyVest balance served when a fresh read failed. */
  primary_stale?: boolean | null;
};

/**
 * True when a purchase of `price` naira should be paid from the PiggyVest
 * wallet: paying from it is switched on, the customer is PiggyVest-ready
 * with a fresh, settled balance, store credit can't cover the price and the
 * PiggyVest wallet can. Store credit still pays first whenever it covers the
 * price, exactly as before. Products add their own rules on top.
 */
export function piggyvestWalletCovers(input: {
  canPay: boolean;
  wallet: PayingWallet | null | undefined;
  price: number;
}) {
  const { wallet, price } = input;
  const kobo = piggyvestPayingBalanceKobo(input);
  if (kobo === null || !wallet) return false;
  if (!Number.isFinite(price) || price <= 0) return false;
  return (wallet.balance ?? 0) < price && kobo >= Math.round(price * 100);
}

/**
 * The PiggyVest balance (kobo) that may pay, or null: switched on and a
 * fresh, settled PiggyVest answer for one known customer. Null for every
 * customer the server reports no PiggyVest wallet for (other merchants).
 */
export function piggyvestPayingBalanceKobo(input: {
  canPay: boolean;
  wallet: PayingWallet | null | undefined;
}): number | null {
  const { wallet } = input;
  if (!input.canPay || !wallet || !isWalletStoreCredit(wallet)) return null;
  if (
    wallet.primary_stale === true ||
    wallet.primary_pending === true ||
    wallet.primary_unavailable === true ||
    wallet.owner_unresolved === true
  )
    return null;
  return wallet.primary_balance_kobo ?? null;
}
