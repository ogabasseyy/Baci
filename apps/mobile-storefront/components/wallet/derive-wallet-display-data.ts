import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { isWalletPrimaryUnknown } from '@/lib/is-wallet-primary-unknown';
import { isWalletStoreCredit } from '@/lib/wallet-store-credit';
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
  owner_unresolved?: boolean | null;
  primary_balance_kobo?: number | null;
  primary_pending?: boolean | null;
  primary_unavailable?: boolean | null;
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
  // Once the server reports the PiggyVest main wallet, walletBalance is that
  // savings wallet: it funds savings goals only and is never spent on
  // purchases. Purchases spend the legacy balance, shown as store credit.
  // Without a PiggyVest answer this is exactly the legacy computation.
  // Same check as every purchase screen, so a malformed balance (NaN,
  // negative) keeps the whole app on the legacy wallet consistently.
  const primaryReady = isWalletStoreCredit(walletData);
  const walletBalance =
    primaryReady && typeof walletData.primary_balance_kobo === 'number'
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
    ? walletBalance + savingsBalance
    : (walletData.total_balance ?? walletBalance + savingsBalance);
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
    // The legacy balance is the customer's store credit: what IMEI checks,
    // utilities and checkout spend. A contribution already bound to the
    // legacy rail also validates against it, never the savings wallet.
    ...(primaryReady
      ? { primaryReady: true as const, legacyBalance: walletData.balance ?? 0 }
      : {}),
    // The PiggyVest check is unsettled (failed, pending, or no customer row
    // yet): purchase top-ups stay card-only store credit, like IMEI's.
    ...(isWalletPrimaryUnknown(walletData) ||
    walletData.owner_unresolved === true
      ? { walletPrimaryUnsettled: true as const }
      : {}),
    savingsBalance,
    showQuickSave: Boolean(walletData.active_savings_goal),
    walletBalance,
    totalBalance,
  };
}
