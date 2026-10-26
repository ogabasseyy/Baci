import { REDEEMABLE_SAVINGS_STATUSES } from '@/lib/checkout-savings';
import { supabase } from '@/lib/supabase';
import { WalletNumberGoalsSchema } from '@/schemas/wallet-number-goals';
import { coerceWalletDatabaseNumber } from './wallet-data-number';
import { walletGoalMetadata } from './wallet-goal-metadata';
import type { WalletNumbers } from './wallet-number.types';
import { readWalletOwner } from './wallet-owner-data';
import {
  fetchWalletSavingsInterest,
  toWalletSavingsInterestEarnings,
} from './wallet-savings-interest';
import {
  addWalletCurrencyAmounts,
  projectWalletSavingsInterest,
} from './wallet-savings-interest-projection';

export async function fetchWalletNumbers(
  customerId: string | null,
  merchantId: string,
  userId: string | null
): Promise<WalletNumbers | null> {
  const owner = await readWalletOwner(customerId, merchantId, userId);
  if (!owner.customerId) return null;
  const [wallet, goals, interest] = await Promise.all([
    supabase
      .from('customer_wallets')
      .select('available_balance')
      .eq('merchant_id', merchantId)
      .eq('customer_id', owner.customerId)
      .maybeSingle(),
    supabase
      .from('customer_savings_goals')
      .select(
        'id, current_amount, target_amount, product_id, variant_id, title, product_snapshot, contribution_amount, contribution_frequency, source_mode, status, maturity_date'
      )
      .eq('merchant_id', merchantId)
      .eq('customer_id', owner.customerId)
      .in('status', [...REDEEMABLE_SAVINGS_STATUSES]),
    fetchWalletSavingsInterest(merchantId),
  ]);
  if (wallet.error) throw wallet.error;
  if (goals.error) throw goals.error;
  if (interest.status !== 'available')
    throw new Error('Could not refresh savings interest');
  const goalsWithMetadata = Array.isArray(goals.data)
    ? goals.data.map((goal) => ({
        ...goal,
        metadata: walletGoalMetadata(goal),
      }))
    : goals.data;
  const balance =
    wallet.data === null
      ? 0
      : coerceWalletDatabaseNumber(wallet.data?.available_balance);
  if (balance === null) throw new Error('Invalid wallet balance');
  const projected = projectWalletSavingsInterest({
    goals: WalletNumberGoalsSchema.parse(goalsWithMetadata),
    goalInterestKobo: interest.goalInterestKobo,
  });
  return {
    interestTransactions: interest.transactions,
    wallet: {
      balance,
      loyalty_points: owner.loyaltyPoints,
      ...toWalletSavingsInterestEarnings(interest),
      savings_balance: projected.savingsBalance,
      total_balance: addWalletCurrencyAmounts(
        balance,
        projected.savingsBalance
      ),
    },
    goals: WalletNumberGoalsSchema.parse(projected.goals),
  };
}
