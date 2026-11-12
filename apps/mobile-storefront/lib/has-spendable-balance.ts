/**
 * Flip to true when the "Pay from your wallet" project lets the PiggyVest
 * savings wallet pay for purchases; the rule below then counts it too.
 */
export const SAVINGS_WALLET_CAN_PAY = false;

interface SpendableBalanceInput {
  /** Older wallet balance in naira: what purchases spend today. */
  storeCreditBalance: number | undefined;
  /** PiggyVest main wallet in naira: funds savings goals only for now. */
  savingsWalletBalance: number | undefined;
}

/**
 * True when a PiggyVest customer has money a purchase can actually spend.
 * Only for PiggyVest-ready customers: others keep their existing rules.
 */
export function hasSpendableBalance({
  storeCreditBalance,
  savingsWalletBalance,
}: SpendableBalanceInput): boolean {
  if ((storeCreditBalance ?? 0) > 0) return true;
  return SAVINGS_WALLET_CAN_PAY && (savingsWalletBalance ?? 0) > 0;
}
