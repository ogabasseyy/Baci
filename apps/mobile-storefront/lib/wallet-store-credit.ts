interface WalletPrimaryLike {
  primary_balance_kobo?: number | null;
  primary_unavailable?: boolean | null;
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
