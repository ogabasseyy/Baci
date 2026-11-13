type WalletPurchaseDisplay =
  | {
      legacyBalance?: number;
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
  storeCreditBalance: number | undefined;
  walletPrimaryUnsettled: boolean;
} {
  return {
    storeCreditBalance: display?.legacyBalance,
    walletPrimaryUnsettled: display?.walletPrimaryUnsettled === true,
  };
}
