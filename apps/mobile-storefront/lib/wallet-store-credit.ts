interface WalletPrimaryLike {
  primary_balance_kobo?: number | null;
}

/**
 * True once the server reports the customer's PiggyVest main wallet. From
 * then on that money funds savings goals only, and purchases (IMEI checks,
 * utilities, checkout) spend the older wallet balance, shown as "Store
 * credit". False keeps every purchase screen exactly as before.
 */
export function isWalletStoreCredit(
  wallet: WalletPrimaryLike | null | undefined
): boolean {
  return typeof wallet?.primary_balance_kobo === 'number';
}
