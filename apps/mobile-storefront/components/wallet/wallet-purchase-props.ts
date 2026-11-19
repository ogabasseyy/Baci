type WalletPurchaseDisplay =
  | {
      legacyBalance?: number;
      primaryStale?: true;
      primaryUnreadable?: true;
      savingsPrimary?: true;
      walletPrimaryUnsettled?: true;
    }
  | null
  | undefined;

/**
 * The wallet screen's purchase-facing props: the spendable store credit
 * and whether the PiggyVest check is unsettled (so the Add money sheet
 * treats a purchase top-up like the purchase screens did).
 */
export function walletPurchaseProps(display: WalletPurchaseDisplay): {
  primaryStale: boolean;
  primaryUnreadable: boolean;
  savingsPrimary: boolean;
  storeCreditBalance: number | undefined;
  walletPrimaryUnsettled: boolean;
} {
  return {
    // The PiggyVest balance is recalled, not fresh: the account gets a hint.
    primaryStale: display?.primaryStale === true,
    // The PiggyVest read failed: the hero shows "can't check right now".
    primaryUnreadable: display?.primaryUnreadable === true,
    // PiggyVest confirmed, ready or pending (with or without an account).
    savingsPrimary: display?.savingsPrimary === true,
    storeCreditBalance: display?.legacyBalance,
    walletPrimaryUnsettled: display?.walletPrimaryUnsettled === true,
  };
}
