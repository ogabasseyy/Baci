import { REDEEMABLE_SAVINGS_STATUSES } from '@/lib/checkout-savings';
import { supabase } from '@/lib/supabase';
import { mergeSavingsHistory } from './merge-savings-history';
import {
  readPrimaryFundingAccount,
  resolveWalletFundingAccount,
} from './resolve-wallet-funding-account';
import { walletGoalMetadata } from './wallet-goal-metadata';
import { runWithWalletLoadDeadline } from './wallet-load-deadline';
import { readWalletOwner } from './wallet-owner-data';
import type { WalletData, WalletQueryData } from './wallet-query';
import {
  getActiveSavingsGoal,
  getOwnedSavingsGoals,
  type SavingsGoalData,
  toActiveSavingsGoal,
} from './wallet-savings-data';
import {
  fetchWalletSavingsInterest,
  toWalletSavingsInterestEarnings,
} from './wallet-savings-interest';
import {
  addWalletCurrencyAmounts,
  projectWalletSavingsInterest,
} from './wallet-savings-interest-projection';
import { hydrateWalletSavingsProducts } from './wallet-savings-product-hydration';
import { fetchWalletTransactions } from './wallet-transaction-data';
import { coerceDatabaseNumber } from './wallet-transaction-normalize';

const PRIMARY_FUNDING_ACCOUNT_TIMEOUT_MS = 5000;

function readPrimaryFundingAccountSoon(
  merchantId: string,
  userId: string,
  read = readPrimaryFundingAccount
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<
    Awaited<ReturnType<typeof readPrimaryFundingAccount>>
  >((resolve) => {
    timer = setTimeout(
      () => resolve({ status: 'unavailable' }),
      PRIMARY_FUNDING_ACCOUNT_TIMEOUT_MS
    );
  });
  return Promise.race([
    read(merchantId, userId).finally(() => {
      if (timer !== undefined) clearTimeout(timer);
    }),
    timeout,
  ]);
}

function getEmptyWalletData(loyaltyPoints = 0): WalletQueryData {
  return {
    wallet: {
      active_savings_goal: null,
      balance: 0,
      earnings_available: false,
      earnings_balance: 0,
      funding_account: null,
      loyalty_points: loyaltyPoints,
      requires_funding_account_consent: true,
      savings_balance: 0,
      savings_goals: [],
      total_balance: 0,
    },
    transactions: [],
  };
}

export function fetchWalletData(
  customerId: string | null,
  merchantId: string,
  userId: string | null,
  options?: WalletReadOptions
): Promise<WalletQueryData> {
  return runWithWalletLoadDeadline(() =>
    fetchWalletDataUnbounded(customerId, merchantId, userId, options)
  );
}

interface WalletReadOptions {
  onBalances?: (wallet: WalletData) => void;
  readPrimary?: typeof readPrimaryFundingAccount;
}

export async function fetchWalletDataUnbounded(
  customerId: string | null,
  merchantId: string,
  userId: string | null,
  options?: WalletReadOptions
): Promise<WalletQueryData> {
  const owner = await readWalletOwner(customerId, merchantId, userId);
  const resolvedCustomerId = owner.customerId;
  if (!resolvedCustomerId) return getEmptyWalletData(owner.loyaltyPoints);

  const walletRead = Promise.resolve(
    supabase
      .from('customer_wallets')
      .select('id, available_balance')
      .eq('merchant_id', merchantId)
      .eq('customer_id', resolvedCustomerId)
      .maybeSingle()
  ).then((result) => {
    if (result.error) throw result.error;
    return result.data;
  });
  const fundingAccountRead = supabase
    .from('customer_wallet_payment_accounts')
    .select('account_name, account_number, bank_name, provider')
    .eq('merchant_id', merchantId)
    .eq('customer_id', resolvedCustomerId)
    .eq('provider', 'paystack')
    .eq('status', 'active')
    .maybeSingle();
  const goalsRead = Promise.resolve(
    supabase
      .from('customer_savings_goals')
      .select(
        'id, product_id, variant_id, title, product_snapshot, target_amount, current_amount, contribution_amount, contribution_frequency, source_mode, status, maturity_date, products(id, name, images, condition, price)'
      )
      .eq('merchant_id', merchantId)
      .eq('customer_id', resolvedCustomerId)
      .in('status', [...REDEEMABLE_SAVINGS_STATUSES])
      .order('created_at', { ascending: false })
  ).then((result) => {
    if (result.error) throw result.error;
    return Array.isArray(result.data) ? result.data : [];
  });
  const interestRead = fetchWalletSavingsInterest(merchantId);
  const balancesRead = Promise.all([walletRead, goalsRead, interestRead]).then(
    ([wallet, goals, interest]) => {
      const projected = projectWalletSavingsInterest({
        goals,
        goalInterestKobo: interest.goalInterestKobo,
      });
      const balance = coerceDatabaseNumber(wallet?.available_balance) ?? 0;
      const preview: WalletData = {
        balance,
        loyalty_points: owner.loyaltyPoints,
        ...toWalletSavingsInterestEarnings(interest),
        savings_balance: projected.savingsBalance,
        total_balance: addWalletCurrencyAmounts(
          balance,
          projected.savingsBalance
        ),
      };
      options?.onBalances?.(preview);
      return preview;
    }
  );
  const [
    wallet,
    fundingAccountResult,
    goals,
    interest,
    primaryFunding,
    products,
    transactions,
    balances,
  ] = await Promise.all([
    walletRead,
    fundingAccountRead,
    goalsRead,
    interestRead,
    readPrimaryFundingAccountSoon(
      merchantId,
      userId ?? resolvedCustomerId,
      options?.readPrimary
    ),
    goalsRead.then(hydrateWalletSavingsProducts),
    walletRead.then((result) =>
      fetchWalletTransactions(merchantId, result?.id)
    ),
    balancesRead,
  ]);
  if (fundingAccountResult.error) throw fundingAccountResult.error;
  const projected = projectWalletSavingsInterest({
    goals,
    goalInterestKobo: interest.goalInterestKobo,
  });
  const active = getActiveSavingsGoal(projected.goals);
  const mapGoal = (goal: SavingsGoalData) =>
    toActiveSavingsGoal({ goal, product: products.get(goal.id) });
  const savingsGoals = getOwnedSavingsGoals(projected.goals).flatMap((goal) => {
    const mapped = mapGoal(goal);
    return mapped ? [mapped] : [];
  });
  const fundingAccount = resolveWalletFundingAccount(
    fundingAccountResult.data,
    primaryFunding
  );
  return {
    walletId: wallet?.id,
    goalMetadata: Object.fromEntries(
      goals.flatMap((goal) => {
        const metadata = walletGoalMetadata(goal);
        return metadata && typeof goal.id === 'string'
          ? [[goal.id, metadata]]
          : [];
      })
    ),
    wallet: {
      ...balances,
      active_savings_goal: active ? mapGoal(active) : null,
      funding_account: fundingAccount,
      requires_funding_account_consent: fundingAccount === null,
      savings_balance: projected.savingsBalance,
      savings_goals: savingsGoals,
      total_balance: addWalletCurrencyAmounts(
        balances.balance,
        projected.savingsBalance
      ),
    },
    transactions: mergeSavingsHistory(transactions, interest.transactions),
  };
}
