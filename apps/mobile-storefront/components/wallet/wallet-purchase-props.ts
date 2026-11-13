type WalletPurchaseDisplay =
  | {
      legacyBalance?: number;
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
  savingsPrimary: boolean;
  storeCreditBalance: number | undefined;
  walletPrimaryUnsettled: boolean;
} {
  return {
    // PiggyVest confirmed, ready or pending (with or without an account).
    savingsPrimary: display?.savingsPrimary === true,
    storeCreditBalance: display?.legacyBalance,
    walletPrimaryUnsettled: display?.walletPrimaryUnsettled === true,
  };
}
