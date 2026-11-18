export interface WalletPrimaryLike {
  primary_balance_kobo?: number | null;
  primary_unavailable?: boolean | null;
  primary_pending?: boolean | null;
  /** No single customer row yet, so the wallet kind is unclassified. */
  owner_unresolved?: boolean | null;
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
  // A malformed balance (NaN, negative) is not a PiggyVest answer.
  const kobo = wallet?.primary_balance_kobo;
  return typeof kobo === 'number' && Number.isFinite(kobo) && kobo >= 0;
}
