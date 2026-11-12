/**
 * "Bank transfer to wallet" pays an order by topping up the older wallet.
 * PiggyVest customers (walletIsStoreCredit) never get it: the standard
 * per-order bank transfer pays the order directly instead of growing that
 * wallet, which is now store credit only.
 */
export function isEligibleForWalletFundedBankTransfer({
  customerId,
  customerPhone,
  isAuthenticated,
  residualAfterSavings,
  walletBalance,
  walletIsStoreCredit = false,
  walletOrderAutoDebitEnabled,
}: {
  customerId?: string | null;
  customerPhone?: string | null;
  isAuthenticated: boolean;
  residualAfterSavings: number;
  walletBalance: number;
  walletIsStoreCredit?: boolean;
  walletOrderAutoDebitEnabled: boolean;
}) {
  return (
    !walletIsStoreCredit &&
    walletOrderAutoDebitEnabled &&
    isAuthenticated &&
    Boolean(customerId) &&
    Boolean(customerPhone) &&
    residualAfterSavings > 0 &&
    walletBalance < residualAfterSavings
  );
}
