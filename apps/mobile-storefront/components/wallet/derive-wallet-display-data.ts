import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import type { WalletDisplayFundingAccount } from './wallet.types';

interface WalletFundingAccountLike {
  account_name?: string | null;
  account_number?: string | null;
  bank_name?: string | null;
  provider?: string | null;
}

interface WalletDataLike {
  active_savings_goal?: WalletActiveSavingsGoal | null;
  balance?: number | null;
  earnings_available?: boolean | null;
  earnings_balance?: number | null;
  funding_account?: WalletFundingAccountLike | null;
  primary_balance_kobo?: number | null;
  savings_balance?: number | null;
  savings_goals?: WalletActiveSavingsGoal[] | null;
  total_balance?: number | null;
}

export function normalizeRequiredFundingAccountValue(
  value: string | null | undefined
): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : null;
}

// The only kobo -> naira conversion for the PiggyVest balance: every other
// app money value (wallet.balance, goal amounts) is already naira.
export function koboToNaira(kobo: number): number {
  return kobo / 100;
}

export function deriveWalletDisplayData(
  walletData: WalletDataLike,
  selectedSavingsGoalId?: string | null
) {
  // PiggyVest main wallet is the spendable balance only when the server
  // reported it; otherwise this is exactly the legacy computation.
  const primaryReady = typeof walletData.primary_balance_kobo === 'number';
  const spendableBalance =
    typeof walletData.primary_balance_kobo === 'number'
      ? koboToNaira(walletData.primary_balance_kobo)
      : (walletData.balance ?? 0);
  const earningsAvailable =
    walletData.earnings_available === true &&
    typeof walletData.earnings_balance === 'number';
  const earningsBalance = earningsAvailable
    ? (walletData.earnings_balance ?? null)
    : null;
  const savingsBalance = walletData.savings_balance ?? 0;
  const totalBalance = primaryReady
    ? spendableBalance + savingsBalance
    : (walletData.total_balance ?? spendableBalance + savingsBalance);
  const rawFundingAccount = walletData.funding_account;
  const accountName = normalizeRequiredFundingAccountValue(
    rawFundingAccount?.account_name
  );
  const accountNumber = normalizeRequiredFundingAccountValue(
    rawFundingAccount?.account_number
  );
  const bankName = normalizeRequiredFundingAccountValue(
    rawFundingAccount?.bank_name
  );
  const provider = normalizeRequiredFundingAccountValue(
    rawFundingAccount?.provider
  );
  const fundingAccount: WalletDisplayFundingAccount | null =
    accountName && accountNumber && bankName && provider
      ? { accountName, accountNumber, bankName, provider }
      : null;

  // A push notification names one owned goal: open that plan instead of
  // the first active row. Membership in the owned list is the trust check —
  // an unknown or missing id falls back to the default active goal.
  const requestedGoalId = selectedSavingsGoalId?.trim() || null;
  const activeSavingsGoal =
    (requestedGoalId &&
      (walletData.savings_goals ?? []).find(
        (goal) => goal.id === requestedGoalId
      )) ||
    walletData.active_savings_goal ||
    null;

  return {
    earningsBalance,
    earningsAvailable,
    activeSavingsGoal,
    fundingAccount,
    // Only present on the PiggyVest path, so the legacy output is unchanged.
    // Legacy rail balance rides along only with the primary fields: a
    // contribution already bound to legacy validates against it, never the
    // primary-derived spendable balance.
    ...(primaryReady
      ? { primaryReady: true as const, legacyBalance: walletData.balance ?? 0 }
      : {}),
    savingsBalance,
    showQuickSave: Boolean(walletData.active_savings_goal),
    spendableBalance,
    totalBalance,
  };
}
